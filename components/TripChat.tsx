'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { collection, deleteField, doc, FieldPath, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { buildReply, reactionSummary, type ChatMessage as Message, type ChatReaction, type ChatReply } from '@/lib/chat';
import { chatSendError, type ChatSendStage } from '@/lib/chatSendError';
import { Check, Copy, LoaderCircle, MessageCircle, Reply, Send, Users, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type ChatInvitation = { roomId: string; code: string };
type Member = { uid: string; name: string };
type Props = {
  tripId: string; chatId?: string; inviteCode?: string; userUid?: string; userName?: string; tripName: string;
  onRoomChange: (id: string, code: string) => void;
  onJoinedRoom: (id: string, code: string, roomName: string) => void;
  onNotice: (message: string) => void;
};
const pendingInviteKey = 'motteku-pending-chat-invite';
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function parseChatInvitation(value: string): ChatInvitation | null {
  try {
    const url = new URL(value.trim(), typeof window === 'undefined' ? 'https://motteku.invalid' : window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.getAll('joinChat').length !== 1 || url.searchParams.getAll('inviteCode').length !== 1) return null;
    const roomId = url.searchParams.get('joinChat');
    const code = url.searchParams.get('inviteCode');
    return validToken(roomId) && validToken(code) ? { roomId, code } : null;
  } catch { return null; }
}

function savedInvitation(): ChatInvitation | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingInviteKey) || 'null');
    return saved && validToken(saved.roomId) && validToken(saved.code) ? { roomId: saved.roomId, code: saved.code } : null;
  } catch { return null; }
}

function rememberInvitation(invitation: ChatInvitation) {
  try { sessionStorage.setItem(pendingInviteKey, JSON.stringify(invitation)); } catch {}
}

function clearInvitation() {
  try { sessionStorage.removeItem(pendingInviteKey); } catch {}
  const url = new URL(window.location.href);
  url.searchParams.delete('joinChat'); url.searchParams.delete('inviteCode');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function TripChat({ tripId, chatId, inviteCode, userUid, userName, tripName, onRoomChange, onJoinedRoom, onNotice }: Props) {
  const { language, t } = useLanguage();
  const [room, setRoom] = useState(chatId || '');
  const [code, setCode] = useState(inviteCode || '');
  const [roomName, setRoomName] = useState(tripName);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(userName || '');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReply | null>(null);
  const [pendingReactions, setPendingReactions] = useState<Set<string>>(new Set());
  const [highlightedMessage, setHighlightedMessage] = useState('');
  const [invitation, setInvitation] = useState<ChatInvitation | null>(null);
  const [joinLink, setJoinLink] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [localLink, setLocalLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendFailureCode, setSendFailureCode] = useState('');
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const knownMessageIds = useRef<Set<string>>(new Set());
  const reactionScope = useRef(0);
  const reactionLocks = useRef<Set<string>>(new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearBottom = useRef(true);
  const forceScroll = useRef(false);
  const actionSerial = useRef(0);
  const sendSerial = useRef(0);
  const busyRef = useRef(false);
  const sendingRef = useRef(false);
  const current = useRef({ uid: userUid, tripId, room });
  current.current = { uid: userUid, tripId, room };

  useEffect(() => {
    reactionScope.current += 1; reactionLocks.current.clear(); setPendingReactions(new Set());
    setReplyTo(null); setHighlightedMessage('');
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setRoom(chatId || ''); setCode(inviteCode || ''); setRoomName(tripName);
    setText(''); setError(''); setLoadError(''); setSendError(''); setSendFailureCode('');
    setBusy(false); setSending(false); busyRef.current = false; sendingRef.current = false;
    actionSerial.current += 1; sendSerial.current += 1; nearBottom.current = true; setNewMessages(false);
  }, [tripId, chatId, inviteCode, userUid, tripName]);

  useEffect(() => { setName(userName || ''); }, [userUid]);
  useEffect(() => { setName(value => value.trim() ? value : userName || ''); }, [userName]);
  useEffect(() => {
    const incoming = parseChatInvitation(window.location.href) || savedInvitation();
    if (incoming) { rememberInvitation(incoming); setInvitation(incoming); }
  }, []);
  useEffect(() => {
    if (!room || !code) { setInviteLink(''); return; }
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('joinChat', room); url.searchParams.set('inviteCode', code);
    setInviteLink(url.toString()); setCopied(false);
    setLocalLink(['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname) || window.location.hostname.endsWith('.localhost'));
  }, [room, code]);
  useEffect(() => {
    setMessages([]); setConnected(false); setLoadError(''); nearBottom.current = true; knownMessageIds.current = new Set();
    if (!room || !userUid || !db || invitation) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const recent = query(collection(db, 'sharedTrips', room, 'messages'), orderBy('createdAt', 'desc'), limit(100));
    const stop = onSnapshot(recent, { includeMetadataChanges: true }, snapshot => {
      if (!active) return;
      const next = snapshot.docs.map(item => ({ ...item.data({ serverTimestamps: 'estimate' }), id: item.id, pending: item.metadata?.hasPendingWrites ?? false } as Message)).reverse();
      if (!nearBottom.current && !forceScroll.current && next.some(item => !knownMessageIds.current.has(item.id))) setNewMessages(true);
      knownMessageIds.current = new Set(next.map(item => item.id));
      setMessages(next);
      setLoading(false); setConnected(true);
    }, () => {
      if (!active) return;
      setLoading(false); setConnected(false); setLoadError('Chat could not load. Check Firebase sign-in and Firestore rules.');
    });
    return () => { active = false; stop(); };
  }, [room, userUid, invitation]);

  useEffect(() => {
    setMembers([]);
    if (!room || !userUid || !db || invitation) return;
    let active = true;
    const stop = onSnapshot(collection(db, 'sharedTrips', room, 'members'), snapshot => {
      if (!active) return;
      const roster = snapshot.docs.map(item => ({ uid: item.id, name: String(item.data().name || t('Trip member')) }));
      setMembers(roster);
      const own = roster.find(member => member.uid === userUid);
      if (own) setName(value => value.trim() ? value : own.name);
    }, () => { if (active) setLoadError('Members could not load. Check Firestore rules.'); });
    return () => { active = false; stop(); };
  }, [room, userUid, invitation]);

  useEffect(() => {
    if (!nearBottom.current && !forceScroll.current) return;
    const frame = requestAnimationFrame(() => {
      const list = messageList.current;
      if (list) list.scrollTop = list.scrollHeight;
      forceScroll.current = false; nearBottom.current = true; setNewMessages(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => () => {
    actionSerial.current += 1; sendSerial.current += 1; reactionScope.current += 1;
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  function validName() {
    if (!name.trim()) { setError('Your name is required.'); return false; }
    if (Array.from(name.trim()).length > 80) { setError('Use 80 characters or fewer.'); return false; }
    return true;
  }

  async function createGroup() {
    if (busyRef.current || !validName()) return;
    if (!tripId) { setError('Create a trip before starting a group chat.'); return; }
    if (!db || !userUid || auth?.currentUser?.uid !== userUid) { setError('Sign in to Firebase to use group chat.'); return; }
    const uid = userUid, selectedTrip = tripId, serial = ++actionSerial.current;
    const stillCurrent = () => serial === actionSerial.current && current.current.uid === uid && current.current.tripId === selectedTrip;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const id = crypto.randomUUID().replaceAll('-', '').slice(0, 24);
      const secret = crypto.randomUUID().replaceAll('-', '');
      await setDoc(doc(db, 'sharedTrips', id), { ownerUid: uid, name: tripName, inviteCode: secret, createdAt: serverTimestamp() });
      if (auth?.currentUser?.uid !== uid) return;
      await setDoc(doc(db, 'sharedTrips', id, 'members', uid), { uid, name: name.trim(), inviteCode: secret, joinedAt: serverTimestamp() });
      if (!stillCurrent() || auth?.currentUser?.uid !== uid) return;
      setRoom(id); setCode(secret); setRoomName(tripName); onRoomChange(id, secret);
    } catch { if (stillCurrent()) setError('Could not create chat. Check Firebase sign-in and Firestore rules.'); }
    finally { if (stillCurrent()) { busyRef.current = false; setBusy(false); } }
  }

  async function joinGroup(incoming: ChatInvitation) {
    if (busyRef.current || !validName()) return;
    if (!db || !userUid || auth?.currentUser?.uid !== userUid) { setError('Sign in to Firebase to use group chat.'); return; }
    const uid = userUid, selectedTrip = tripId, serial = ++actionSerial.current;
    const stillCurrent = () => serial === actionSerial.current && current.current.uid === uid && current.current.tripId === selectedTrip;
    rememberInvitation(incoming); setInvitation(incoming); busyRef.current = true; setBusy(true); setError('');
    try {
      const member = doc(db, 'sharedTrips', incoming.roomId, 'members', uid);
      const existing = await getDoc(member);
      if (auth?.currentUser?.uid !== uid) return;
      if (!existing.exists()) await setDoc(member, { uid, name: name.trim(), inviteCode: incoming.code, joinedAt: serverTimestamp() });
      if (auth?.currentUser?.uid !== uid) return;
      const group = await getDoc(doc(db, 'sharedTrips', incoming.roomId));
      if (!stillCurrent() || auth?.currentUser?.uid !== uid) return;
      if (!group.exists()) throw new Error('Group no longer exists.');
      const data = group.data();
      const groupName = typeof data.name === 'string' ? data.name : tripName;
      const groupCode = validToken(data.inviteCode) ? data.inviteCode : incoming.code;
      clearInvitation(); setInvitation(null); setJoinLink('');
      setRoom(incoming.roomId); setCode(groupCode); setRoomName(groupName);
      onJoinedRoom(incoming.roomId, groupCode, groupName); onNotice(t('Joined the trip chat.'));
    } catch { if (stillCurrent()) setError('Could not join. Check the invite link and Firebase rules.'); }
    finally { if (stillCurrent()) { busyRef.current = false; setBusy(false); } }
  }

  function joinFromLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const incoming = parseChatInvitation(joinLink);
    if (!incoming) { setError('Invalid invite link. Paste the complete link from your group.'); return; }
    void joinGroup(incoming);
  }

  async function copyInvite() {
    if (!inviteLink) return;
    setError('');
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); onNotice(t('Invite link copied.')); }
    catch { setError('Copy is unavailable. Select and copy the invite link below.'); }
  }

  function selectReply(message: Message) {
    if (sendingRef.current || busyRef.current || !connected || message.pending) return;
    const selected = buildReply(message);
    if (!selected) { setError('The original message is not available. Choose another message to reply to.'); return; }
    setReplyTo(selected); setError(''); setSendError(''); setSendFailureCode(''); composerInput.current?.focus();
  }

  function showOriginal(messageId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId) || !messages.some(message => message.id === messageId)) { setError('Original message is outside the latest 100 messages.'); return; }
    const element = messageList.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); element?.focus({ preventScroll: true });
    setHighlightedMessage(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedMessage(''), 2000);
  }

  async function react(message: Message, reaction: ChatReaction) {
    if (!db || !userUid || auth?.currentUser?.uid !== userUid || !room || !connected || invitation || message.pending || sendingRef.current || busyRef.current || reactionLocks.current.has(message.id)) return;
    const uid = userUid, targetRoom = room, scope = reactionScope.current;
    const stillCurrent = () => scope === reactionScope.current && current.current.uid === uid && current.current.room === targetRoom;
    reactionLocks.current.add(message.id); setPendingReactions(new Set(reactionLocks.current)); setError('');
    try {
      const selected = reactionSummary(message.reactions, uid).find(item => item.id === reaction)?.selected;
      await updateDoc(doc(db, 'sharedTrips', targetRoom, 'messages', message.id), new FieldPath('reactions', uid), selected ? deleteField() : reaction);
    } catch { if (stillCurrent()) setError('Could not update reaction. Check group membership and Firestore rules.'); }
    finally { if (stillCurrent()) { reactionLocks.current.delete(message.id); setPendingReactions(new Set(reactionLocks.current)); } }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || busyRef.current || !room || !connected || invitation || !text.trim()) return;
    setSendError(''); setSendFailureCode('');
    if (!name.trim()) { setSendError('Your name is required.'); return; }
    if (Array.from(name.trim()).length > 80) { setSendError('Use 80 characters or fewer.'); return; }
    if (!db || !userUid || auth?.currentUser?.uid !== userUid) { setSendError('Sign in to Firebase to use group chat.'); return; }
    if (text.trim().length > 2000) { setSendError('Messages can contain up to 2000 characters.'); return; }
    const uid = userUid, targetRoom = room, serial = ++sendSerial.current;
    const draftText = text.trim(), draftReply = replyTo, displayName = name.trim();
    const stillCurrent = () => serial === sendSerial.current && current.current.uid === uid && current.current.room === targetRoom;
    sendingRef.current = true; setSending(true); setError('');
    let stage: ChatSendStage = draftReply ? 'reply-read' : 'message-write';
    try {
      const message = doc(collection(db, 'sharedTrips', targetRoom, 'messages'));
      const payload: Record<string, unknown> = { senderUid: uid, senderName: displayName, text: draftText, createdAt: serverTimestamp() };
      if (draftReply) {
        const original = await getDoc(doc(db, 'sharedTrips', targetRoom, 'messages', draftReply.messageId));
        if (!stillCurrent() || auth?.currentUser?.uid !== uid) return;
        const quote = original.exists() ? buildReply({ ...original.data(), id: draftReply.messageId } as Message) : null;
        if (!quote) { setSendError('The original message is not available. Choose another message to reply to.'); return; }
        payload.replyTo = quote;
      }
      if (!stillCurrent() || auth?.currentUser?.uid !== uid) return;
      forceScroll.current = true;
      stage = 'message-write';
      await setDoc(message, payload);
      if (stillCurrent()) { setText(''); setReplyTo(null); setSendError(''); setSendFailureCode(''); }
    } catch (failure) {
      if (stillCurrent()) {
        const feedback = chatSendError(failure, stage, Boolean(draftReply));
        setSendError(feedback.message); setSendFailureCode(feedback.code);
      }
    }
    finally { if (stillCurrent()) { sendingRef.current = false; setSending(false); } }
  }

  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.currentTarget.form?.requestSubmit();
    }
  }

  const nameField = <label className="field-label chat-name-field">{t('Your chat name')}<input value={name} maxLength={80} autoComplete="name" disabled={busy || sending} onChange={event => setName(event.target.value)} placeholder={t('e.g. Han')}/></label>;
  return <section className="panel page-panel trip-chat">
    <div className="panel-head"><div><h3><MessageCircle size={17}/>{t('Group chat')}</h3><p>{t('Share this invite link with trip members to chat together.')}</p></div></div>
    {error && <p className="chat-feedback error" role="alert">{t(error)}</p>}
    {nameField}
    {!userUid && <p className="chat-hint">{t('Connecting to Firebase…')}</p>}
    {invitation ? <div className="chat-invite-panel">
      <h4>{t('You have been invited to a group chat.')}</h4><p>{t('Enter your name to join this group.')}</p>
      <p className="chat-hint">{t('This invitation shares the group chat. Packing lists and budgets stay in each member’s workspace.')}</p>
      <div className="chat-invitation-actions"><button type="button" className="primary" disabled={busy || !userUid} onClick={() => void joinGroup(invitation)}>{busy && <LoaderCircle className="spin" size={16}/>} {t(busy ? 'Joining…' : 'Join group')}</button><button type="button" className="soft-button" disabled={busy} onClick={() => { clearInvitation(); setInvitation(null); setError(''); }}>{t('Cancel invitation')}</button></div>
    </div> : <>
      {!room ? <div className="chat-create-panel"><p>{t('Create a group or paste an invite link to join your friends.')}</p><button type="button" className="primary" disabled={busy || !userUid || !tripId} onClick={() => void createGroup()}>{busy && <LoaderCircle className="spin" size={16}/>} {t(busy ? 'Creating…' : 'Create group chat')}</button>{!tripId && <p className="chat-hint">{t('Create a trip before starting a group chat.')}</p>}</div> : <>
        <div className="chat-toolbar"><b>{roomName || tripName}</b><span><Users size={15}/> {t('Members')}: {members.length}</span></div>
        <details className="chat-invite-panel"><summary>{t('Invite members')}</summary><div className="chat-invite-link"><input aria-label={t('Invite link')} value={inviteLink} readOnly onFocus={event => event.currentTarget.select()}/><button type="button" className="soft-button" onClick={() => void copyInvite()} disabled={!inviteLink}>{copied ? <Check size={15}/> : <Copy size={15}/>} {t('Copy invite link')}</button></div><p className="chat-hint">{t('This invitation shares the group chat. Packing lists and budgets stay in each member’s workspace.')}</p>{localLink && <p className="chat-hint">{t('Use your published website link to invite members on other devices. Localhost links only work on this computer.')}</p>}</details>
        <div className="chat-members" aria-label={t('Group members')}><div className="chat-member-list">{members.map(member => <span key={member.uid} className="chat-member-chip">{member.name}</span>)}</div></div>
        {loadError && <p className="chat-feedback error" role="alert">{t(loadError)}</p>}
        <div ref={messageList} className="chat-messages" role="log" aria-label={t('Group chat')} aria-live="polite" aria-relevant="additions" onScroll={() => { const list = messageList.current; if (list) { nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90; if (nearBottom.current) setNewMessages(false); } }}>
          {loading ? <div className="empty-inline"><LoaderCircle className="spin" size={18}/> {t('Connecting to chat…')}</div> : messages.length ? messages.map(message => <div className={`chat-message${message.senderUid === userUid ? ' mine' : ''}${highlightedMessage === message.id ? ' chat-original-highlight' : ''}`} key={message.id} data-message-id={message.id} tabIndex={-1}>
            <b>{message.senderName}</b>
            {message.replyTo && <button type="button" className="chat-reply-quote" onClick={() => showOriginal(message.replyTo!.messageId)} aria-label={t('View original message')}><b>{message.replyTo.senderName}</b><span>{message.replyTo.text || t('Photo attachment removed.')}</span></button>}
            {message.imagePath && <span className="chat-legacy-photo">{t('Photo attachment removed.')}</span>}
            {message.text && <span className="chat-message-copy">{message.text}</span>}
            <small className="chat-message-time">{message.createdAt?.toDate ? message.createdAt.toDate().toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Sending…')}</small>
            <div className="chat-message-actions"><button type="button" className="soft-button" aria-label={t('Reply to {name}', { name: message.senderName })} disabled={sending || busy || !connected || !userUid || message.pending} onClick={() => selectReply(message)}><Reply size={14}/>{t('Reply')}</button></div>
            <div className="chat-reactions" role="group" aria-label={t('Reactions')}>{reactionSummary(message.reactions, userUid).map(reaction => <button type="button" key={reaction.id} className={`chat-reaction${reaction.selected ? ' selected' : ''}`} aria-label={t(reaction.label)} title={t(reaction.label)} aria-pressed={reaction.selected} disabled={sending || busy || !connected || !userUid || message.pending || pendingReactions.has(message.id)} onClick={() => void react(message, reaction.id)}><span aria-hidden="true">{reaction.emoji}</span><small>{reaction.count}</small></button>)}</div>
          </div>) : <div className="empty-inline">{t('No messages yet. Say hello to your group!')}</div>}
        </div>
        {newMessages && <button type="button" className="soft-button chat-unread-button" onClick={() => { const list = messageList.current; if (list) list.scrollTop = list.scrollHeight; nearBottom.current = true; setNewMessages(false); }}>{t('New messages')}</button>}
        <p className="chat-hint">{t('Showing the latest 100 messages.')}</p>
        <form className="chat-compose" onSubmit={send} aria-busy={sending}>
          {replyTo && <div className="chat-reply-preview"><div><b>{t('Replying to {name}', { name: replyTo.senderName })}</b><span>{replyTo.text || t('Photo attachment removed.')}</span></div><button type="button" className="icon-button" disabled={sending} aria-label={t('Cancel reply')} onClick={() => { setReplyTo(null); setSendError(''); setSendFailureCode(''); }}><X size={16}/></button></div>}
          <textarea ref={composerInput} aria-label={t('Write a message…')} value={text} maxLength={2000} rows={2} disabled={sending} placeholder={t('Write a message…')} onChange={event => setText(event.target.value)} onKeyDown={composerKey}/>
          {sendError && <p className="chat-feedback error" role="alert" data-chat-send-error="true">{t(sendError)}{sendFailureCode && <> <code>({sendFailureCode})</code></>}</p>}
          <div className="chat-compose-tools"><button type="submit" className="primary" disabled={sending || busy || !connected || !userUid || !name.trim() || !text.trim()}>{sending ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>} {t(sending ? 'Sending…' : 'Send message')}</button></div>
        </form>
      </>}
      <details className="chat-invite-panel"><summary>{t('Join with an invite link')}</summary><form className="chat-join-form" onSubmit={joinFromLink}><label className="field-label">{t('Paste invite link')}<input type="text" value={joinLink} onChange={event => setJoinLink(event.target.value)} placeholder="https://…/?joinChat=…&inviteCode=…" autoComplete="off"/></label><button type="submit" className="soft-button" disabled={busy || !userUid || !joinLink.trim()}>{t('Join group')}</button></form></details>
    </>}
  </section>;
}
