"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collection, deleteField, doc, FieldPath, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { BarChart3, LoaderCircle, Plus, X } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';
import { pollErrorCode, pollResults, readPoll, validatePollDraft, type GroupPoll } from '@/lib/polls';

type Props = {
  kind: 'chat' | 'trip';
  scopeId: string;
  uid: string;
  userName: string;
  canManage: boolean;
  disabled?: boolean;
};
type Notice = { key: string; code?: string };

export default function GroupPolls({ kind, scopeId, uid, userName, canManage, disabled = false }: Props) {
  const { t } = useLanguage();
  const [polls, setPolls] = useState<GroupPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Notice | null>(null);
  const [actionError, setActionError] = useState<Notice | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState<string[]>([]);
  const [created, setCreated] = useState(false);
  const key = `${kind}/${scopeId}/${uid}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const current = useRef({ polls, loading, loadError, disabled, canManage });
  current.current = { polls, loading, loadError, disabled, canManage };
  const configured = Boolean(db && uid && scopeId && !scopeId.includes('/') && scopeId.length <= 128);
  const base = kind === 'chat' ? 'sharedTrips' : 'trips';

  useEffect(() => {
    const version = ++generation.current;
    let subscribed = true;
    locks.current = new Set();
    setPolls([]); setLoading(configured); setLoadError(null); setActionError(null);
    setQuestion(''); setOptions(['', '']); setBusy([]); setCreated(false);
    if (!db || !configured) return () => { subscribed = false; generation.current++; };
    const unsubscribe = onSnapshot(
      query(collection(db, base, scopeId, 'polls'), orderBy('createdAt', 'desc'), limit(20)),
      { includeMetadataChanges: true },
      snapshot => {
        if (!subscribed || activeKey.current !== key || generation.current !== version) return;
        setPolls(snapshot.docs.flatMap(item => {
          const poll = readPoll(item.id, item.data(), item.metadata.hasPendingWrites);
          return poll ? [poll] : [];
        }));
        setLoading(false); setLoadError(null);
      },
      error => {
        if (!subscribed || activeKey.current !== key || generation.current !== version) return;
        setPolls([]); setLoading(false);
        setLoadError({ key: 'Could not load polls. Check your membership and Firestore rules.', code: pollErrorCode(error) });
      },
    );
    return () => { subscribed = false; generation.current++; unsubscribe(); };
  }, [key, base, configured, scopeId]);

  function allowed() {
    return configured && activeKey.current === key && auth?.currentUser?.uid === uid
      && !current.current.loading && !current.current.loadError && !current.current.disabled;
  }

  // Refs block repeated clicks immediately, before React can render disabled controls.
  async function perform(lock: string, errorKey: string, write: () => Promise<void>, success?: () => void) {
    if (!allowed() || locks.current.has(lock)) return;
    const version = generation.current;
    const actionLocks = locks.current;
    actionLocks.add(lock); setBusy([...actionLocks]); setActionError(null); setCreated(false);
    const sameContext = () => activeKey.current === key && generation.current === version && auth?.currentUser?.uid === uid;
    try {
      await write();
      if (sameContext()) success?.();
    } catch (error) {
      if (sameContext()) setActionError({ key: errorKey, code: pollErrorCode(error) });
    } finally {
      actionLocks.delete(lock);
      if (sameContext() && actionLocks === locks.current) setBusy([...actionLocks]);
    }
  }

  async function createPoll(event: FormEvent) {
    event.preventDefault();
    if (!db || !allowed() || locks.current.has('create')) return;
    const draft = validatePollDraft(question, options, userName);
    if (!draft.ok) { setActionError({ key: draft.error }); return; }
    const target = doc(collection(db, base, scopeId, 'polls'));
    await perform('create', 'Could not create the poll. Your draft is kept; please try again.', () => setDoc(target, {
      question: draft.question, options: draft.options, createdBy: uid,
      createdByName: draft.createdByName, createdAt: serverTimestamp(), closed: false,
    }), () => { setQuestion(''); setOptions(['', '']); setCreated(true); });
  }

  async function vote(pollId: string, index: number) {
    const poll = current.current.polls.find(item => item.id === pollId);
    if (!db || !allowed() || !poll || poll.closed || poll.pending || index < 0 || index >= poll.options.length || !Number.isInteger(index)) return;
    const selected = pollResults(poll.options, poll.votes, uid).selectedIndex === index;
    await perform(pollId, 'Could not save your vote. Please try again.', () => updateDoc(
      doc(db!, base, scopeId, 'polls', pollId), new FieldPath('votes', uid), selected ? deleteField() : index,
    ));
  }

  async function closePoll(pollId: string) {
    const poll = current.current.polls.find(item => item.id === pollId);
    if (!db || !allowed() || !poll || poll.closed || poll.pending || (poll.createdBy !== uid && !current.current.canManage)) return;
    await perform(pollId, 'Could not close the poll. Please try again.', () => updateDoc(
      doc(db!, base, scopeId, 'polls', pollId), { closed: true, closedAt: serverTimestamp() },
    ));
  }

  const unavailable = !configured || loading || Boolean(loadError) || disabled;
  const creating = busy.includes('create');
  const notice = (value: Notice) => <>{t(value.key)}{value.code && <span className="poll-error-code"> ({value.code})</span>}</>;

  return <section className="group-polls" aria-label={t('Group polls')}>
    <div className="polls-heading"><div><h2><BarChart3 size={21} />{t('Group polls')}</h2><p className="muted">{t('Choose together. Each member has one vote per poll.')}</p></div></div>
    {!configured ? <p className="muted">{t('Sign in and connect Firebase to use group polls.')}</p> : <>
      {disabled && <p className="muted">{t('Polls are read-only right now.')}</p>}
      {loadError && <p role="alert" className="polls-error">{notice(loadError)}</p>}
      {actionError && <p role="alert" className="polls-error">{notice(actionError)}</p>}
      {created && <p role="status" className="polls-success">{t('Poll created.')}</p>}
      {!disabled && <form className="poll-create" onSubmit={createPoll}>
        <label>{t('Poll question')}<input aria-label={t('Poll question')} value={question} disabled={unavailable || creating} placeholder={t('Where should we meet?')} onChange={event => { setQuestion(event.target.value); setCreated(false); }} /></label>
        <div className="poll-create-options">{options.map((option, index) => <div className="poll-create-option" key={index}>
          <label>{t('Option {number}', { number: index + 1 })}<input aria-label={t('Option {number}', { number: index + 1 })} value={option} disabled={unavailable || creating} onChange={event => setOptions(previous => previous.map((text, at) => at === index ? event.target.value : text))} /></label>
          {options.length > 2 && <button type="button" className="icon-button" disabled={unavailable || creating} aria-label={t('Remove option {number}', { number: index + 1 })} onClick={() => setOptions(previous => previous.filter((_, at) => at !== index))}><X size={16} /></button>}
        </div>)}</div>
        <div className="poll-create-actions">
          <button type="button" className="button secondary" disabled={unavailable || creating || options.length >= 5} onClick={() => setOptions(previous => previous.length < 5 ? [...previous, ''] : previous)}><Plus size={16} />{t('Add option')}</button>
          <button type="submit" className="button primary" disabled={unavailable || creating}>{creating && <LoaderCircle size={16} className="spin" />}{t(creating ? 'Creating poll…' : 'Create poll')}</button>
        </div>
      </form>}
      {loading ? <p role="status" className="muted">{t('Loading polls…')}</p> : !loadError && !polls.length && <p className="polls-empty">{t('No polls yet. Create one to make a group decision.')}</p>}
      <div className="poll-list">{polls.map(poll => {
        const results = pollResults(poll.options, poll.votes, uid);
        const locked = unavailable || poll.closed || poll.pending || busy.includes(poll.id);
        return <article className="poll-card" data-poll-id={poll.id} key={poll.id}>
          <div className="poll-card-heading"><h3>{poll.question}</h3><span className={`poll-status${poll.closed ? ' closed' : ''}`}>{t(poll.closed ? 'Closed' : 'Open')}</span></div>
          <p className="muted">{t('Created by {name}', { name: poll.createdByName })}</p>
          <div className="poll-options">{results.options.map((option, index) => <button type="button" className={`poll-option${option.selected ? ' selected' : ''}`} key={index} aria-label={t('Vote for {option}', { option: option.text })} aria-pressed={option.selected} disabled={locked} onClick={() => vote(poll.id, index)}>
            <span className="poll-result-fill" style={{ width: `${option.percent}%` }} aria-hidden="true" />
            <span className="poll-option-label">{option.text}{option.selected && <span className="poll-your-vote">{t('Your vote')}</span>}</span><span className="poll-option-count">{option.count} · {option.percent}%</span>
          </button>)}</div>
          <div className="poll-footer"><span className="muted">{t('{count} votes', { count: results.total })}</span>{!poll.closed && (poll.createdBy === uid || canManage) && <button type="button" className="button secondary" disabled={locked} onClick={() => closePoll(poll.id)}>{t('Close poll')}</button>}</div>
          {poll.pending ? <p role="status" className="muted">{t('Syncing poll…')}</p> : !poll.closed && !disabled && <p className="muted poll-hint">{t('Select another option to change your vote, or select your vote again to remove it.')}</p>}
        </article>;
      })}</div>
      {!loading && polls.length > 0 && <p className="muted">{t('Showing the latest 20 polls.')}</p>}
    </>}
  </section>;
}
