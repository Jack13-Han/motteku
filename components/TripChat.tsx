'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '@/lib/firebase';
import { Check, Copy, ImagePlus, LoaderCircle, MessageCircle, Send, Users, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

type ChatInvitation = { roomId: string; code: string };
type Message = { id: string; senderUid: string; senderName: string; text: string; imagePath?: string; imageName?: string; createdAt?: { toDate: () => Date } | null };
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

export function validateChatPhoto(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Only JPEG, PNG and WebP photos are supported.';
  if (file.size > 10 * 1024 * 1024) return 'Choose a photo smaller than 10 MB.';
  return null;
}

async function preparePhoto(file: File): Promise<Blob> {
  const validation = validateChatPhoto(file);
  if (validation) throw new Error(validation);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo could not be prepared. Try another image.');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Photo could not be prepared. Try another image.')); return; }
          if (blob.size > 2 * 1024 * 1024) { reject(new Error('The resized photo is still too large. Choose a smaller photo.')); return; }
          resolve(blob);
        }, 'image/jpeg', 0.8);
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo could not be prepared. Try another image.')); };
    image.src = url;
  });
}

function ChatPhoto({ room, message, onLoad }: { room: string; message: Message; onLoad: () => void }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(''); setFailed(false);
    const expected = `sharedTrips/${room}/chat/${message.senderUid}/${message.id}.jpg`;
    if (!storage || message.imagePath !== expected) { setFailed(true); return; }
    getDownloadURL(ref(storage, expected)).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [room, message.id, message.senderUid, message.imagePath]);
  if (!url || failed) return <div className="chat-photo-placeholder">{failed ? t('Photo could not load.') : <><LoaderCircle className="spin" size={17}/>{t('Loading photo…')}</>}</div>;
  return <a className="chat-photo-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={t('Open photo')}><img className="chat-photo" src={url} alt={message.imageName || t('Chat photo')} loading="lazy" onLoad={onLoad} onError={() => setFailed(true)}/></a>;
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
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [invitation, setInvitation] = useState<ChatInvitation | null>(null);
  const [joinLink, setJoinLink] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [localLink, setLocalLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const forceScroll = useRef(false);
  const actionSerial = useRef(0);
  const sendSerial = useRef(0);
  const busyRef = useRef(false);
  const sendingRef = useRef(false);
  const current = useRef({ uid: userUid, tripId, room });
  current.current = { uid: userUid, tripId, room };

  useEffect(() => {
    setRoom(chatId || ''); setCode(inviteCode || ''); setRoomName(tripName);
    setText(''); setPhoto(null); setError(''); setLoadError('');
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
    if (!photo) { setPhotoPreview(''); return; }
    const url = URL.createObjectURL(photo); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    setMessages([]); setConnected(false); setLoadError(''); nearBottom.current = true;
    if (!room || !userUid || !db || invitation) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const recent = query(collection(db, 'sharedTrips', room, 'messages'), orderBy('createdAt', 'desc'), limit(100));
    const stop = onSnapshot(recent, snapshot => {
      if (!active) return;
      if (!nearBottom.current && !forceScroll.current) setNewMessages(true);
      setMessages(snapshot.docs.map(item => ({ ...item.data({ serverTimestamps: 'estimate' }), id: item.id } as Message)).reverse());
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

  useEffect(() => () => { actionSerial.current += 1; sendSerial.current += 1; }, []);

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

  function choosePhoto(file?: File) {
    if (!file) return;
    const validation = validateChatPhoto(file);
    if (validation) { setError(validation); return; }
    setError(''); setPhoto(file);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || busyRef.current || !room || !connected || invitation || (!text.trim() && !photo) || !validName()) return;
    if (!db || !userUid || auth?.currentUser?.uid !== userUid) { setError('Sign in to Firebase to use group chat.'); return; }
    if (text.trim().length > 2000) { setError('Messages can contain up to 2000 characters.'); return; }
    if (photo && !storage) { setError('Photos require Firebase Storage to be configured.'); return; }
    const uid = userUid, targetRoom = room, serial = ++sendSerial.current;
    const draftText = text.trim(), draftPhoto = photo, displayName = name.trim();
    const stillCurrent = () => serial === sendSerial.current && current.current.uid === uid && current.current.room === targetRoom;
    sendingRef.current = true; setSending(true); setError('');
    let uploadedPath = '';
    let preparing = Boolean(draftPhoto);
    try {
      const message = doc(collection(db, 'sharedTrips', targetRoom, 'messages'));
      const payload: Record<string, unknown> = { senderUid: uid, senderName: displayName, text: draftText, createdAt: serverTimestamp() };
      if (draftPhoto && storage) {
        const blob = await preparePhoto(draftPhoto);
        preparing = false;
        if (!stillCurrent() || auth?.currentUser?.uid !== uid) return;
        const path = `sharedTrips/${targetRoom}/chat/${uid}/${message.id}.jpg`;
        await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' });
        uploadedPath = path;
        payload.imagePath = path; payload.imageName = draftPhoto.name.slice(0, 120);
      }
      if (!stillCurrent() || auth?.currentUser?.uid !== uid) {
        // The upload exists, but no Firestore write has been attempted yet.
        if (uploadedPath && storage && auth?.currentUser?.uid === uid) {
          try { await deleteObject(ref(storage, uploadedPath)); } catch {}
        }
        return;
      }
      forceScroll.current = true;
      await setDoc(message, payload);
      if (stillCurrent()) { setText(''); setPhoto(null); if (fileInput.current) fileInput.current.value = ''; }
    } catch (failure) {
      const firebaseCode = (failure as { code?: string }).code;
      // Only remove a pending upload when Firestore has definitely rejected the write.
      if (uploadedPath && storage && ['permission-denied', 'invalid-argument'].includes(firebaseCode || '')) {
        try { await deleteObject(ref(storage, uploadedPath)); } catch {}
      }
      if (stillCurrent()) {
        const message = failure instanceof Error ? failure.message : '';
        setError(preparing && message ? message : draftPhoto ? 'Photo was not sent. Check Firebase Storage rules.' : 'Message was not sent. Check Firebase permissions.');
      }
    } finally { if (stillCurrent()) { sendingRef.current = false; setSending(false); } }
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
          {loading ? <div className="empty-inline"><LoaderCircle className="spin" size={18}/> {t('Connecting to chat…')}</div> : messages.length ? messages.map(message => <div className={`chat-message${message.senderUid === userUid ? ' mine' : ''}`} key={message.id}><b>{message.senderName}</b>{message.imagePath && <ChatPhoto room={room} message={message} onLoad={() => { const list = messageList.current; if (list && nearBottom.current) list.scrollTop = list.scrollHeight; }}/>} {message.text && <span className="chat-message-copy">{message.text}</span>}<small className="chat-message-time">{message.createdAt?.toDate ? message.createdAt.toDate().toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('Sending…')}</small></div>) : <div className="empty-inline">{t('No messages yet. Say hello to your group!')}</div>}
        </div>
        {newMessages && <button type="button" className="soft-button chat-unread-button" onClick={() => { const list = messageList.current; if (list) list.scrollTop = list.scrollHeight; nearBottom.current = true; setNewMessages(false); }}>{t('New messages')}</button>}
        <p className="chat-hint">{t('Showing the latest 100 messages.')}</p>
        <form className="chat-compose" onSubmit={send} aria-busy={sending}>
          {photo && <div className="chat-draft-photo">{photoPreview && <img src={photoPreview} alt={t('Photo ready to send')}/>}<div><b>{t('Photo ready to send')}</b><small>{photo.name}</small></div><button type="button" className="icon-button" disabled={sending} aria-label={t('Remove photo')} onClick={() => { setPhoto(null); if (fileInput.current) fileInput.current.value = ''; }}><X size={16}/></button></div>}
          <textarea aria-label={t('Write a message…')} value={text} maxLength={2000} rows={2} disabled={sending} placeholder={t('Write a message…')} onChange={event => setText(event.target.value)} onKeyDown={composerKey}/>
          <input ref={fileInput} type="file" className="file-input" accept="image/jpeg,image/png,image/webp" aria-label={t('Select a photo')} onChange={event => choosePhoto(event.target.files?.[0])}/>
          <div className="chat-compose-tools"><button type="button" className="soft-button" disabled={sending || !storage || !connected} onClick={() => fileInput.current?.click()}><ImagePlus size={17}/>{t('Add photo')}</button><button type="submit" className="primary" disabled={sending || !connected || !userUid || !name.trim() || (!text.trim() && !photo)}>{sending ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>} {t(sending ? 'Sending…' : 'Send message')}</button></div>
          <p className="chat-hint">{t(storage ? 'JPEG, PNG or WebP, up to 10 MB. Photos are resized before sending.' : 'Photos require Firebase Storage to be configured.')}</p>
        </form>
      </>}
      <details className="chat-invite-panel"><summary>{t('Join with an invite link')}</summary><form className="chat-join-form" onSubmit={joinFromLink}><label className="field-label">{t('Paste invite link')}<input type="text" value={joinLink} onChange={event => setJoinLink(event.target.value)} placeholder="https://…/?joinChat=…&inviteCode=…" autoComplete="off"/></label><button type="submit" className="soft-button" disabled={busy || !userUid || !joinLink.trim()}>{t('Join group')}</button></form></details>
    </>}
  </section>;
}
