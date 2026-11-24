'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';
import { packingItemName } from '@/lib/packing';
import type { usePacking } from '@/lib/usePacking';
import { departureSummary, hashReadinessContext, linkedReadinessMember, readinessContext, readinessError, type DepartureConfirmation, type DepartureRequirement } from '@/lib/readiness';

type Props = { scope: string; uid: string; packing: ReturnType<typeof usePacking>; readOnly?: boolean };
type StoredReadiness = { requirements: DepartureRequirement[]; confirmations: DepartureConfirmation[] };
const empty = (): StoredReadiness => ({ requirements: [], confirmations: [] });
const localTime = () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: (Date.now() % 1000) * 1000000 });

export default function DepartureReadiness({ scope, uid, packing, readOnly = false }: Props) {
  const { t } = useLanguage();
  const { data, loaded: packingLoaded, busy: packingBusy, synced: packingSynced, cloud } = packing;
  const [stored, setStored] = useState<StoredReadiness>(empty);
  const [loaded, setLoaded] = useState(false), [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [hashes, setHashes] = useState<{ signature: string; values: Record<string, string> }>({ signature: '', values: {} });
  const current = useRef({ scope, uid, serial: 0 });
  const saving = useRef(false);
  const localKey = `motteku-departure-v1:${scope}`;
  // Synchronous identity check also closes the interval before the next effect resets state.
  const sameIdentity = current.current.scope === scope && current.current.uid === uid;
  if (!sameIdentity) current.current = { scope, uid, serial: current.current.serial + 1 };

  useEffect(() => {
    let cancelled = false;
    const identity = current.current;
    setStored(empty()); setLoaded(false); setPending(false); setBusy(false); setError(''); saving.current = false;
    const active = () => !cancelled && current.current === identity;
    if (!scope || !uid) return;
    if (!cloud) {
      try {
        const saved = localStorage.getItem(localKey);
        const parsed = saved ? JSON.parse(saved) : empty();
        if (!Array.isArray(parsed.requirements) || !Array.isArray(parsed.confirmations)) throw new Error('Invalid local readiness');
        setStored(parsed); setLoaded(true);
      } catch (failure) { setError(readinessError(failure, 'load')); }
      return () => { cancelled = true; };
    }
    if (!db || auth?.currentUser?.uid !== uid) { setError('Waiting for Firebase sign-in.'); return; }
    const parent = doc(db, 'packingTrips', scope);
    let requirementsReady = false, confirmationsReady = false, requirementsPending = false, confirmationsPending = false, failed = false;
    const update = () => { if (active()) { setLoaded(!failed && requirementsReady && confirmationsReady); setPending(requirementsPending || confirmationsPending); } };
    const fail = (failure: unknown) => { if (active()) { failed = true; setLoaded(false); setError(readinessError(failure, 'load')); } };
    const stopRequirements = onSnapshot(collection(parent, 'departureRequirements'), { includeMetadataChanges: true }, snapshot => {
      if (!active()) return;
      setStored(previous => ({ ...previous, requirements: snapshot.docs.map(row => ({ ...row.data(), itemId: row.id } as DepartureRequirement)) }));
      requirementsReady = true; requirementsPending = snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache; update();
    }, fail);
    const stopConfirmations = onSnapshot(collection(parent, 'departureConfirmations'), { includeMetadataChanges: true }, snapshot => {
      if (!active()) return;
      setStored(previous => ({ ...previous, confirmations: snapshot.docs.map(row => ({ ...row.data(), uid: row.id } as DepartureConfirmation)) }));
      confirmationsReady = true; confirmationsPending = snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache; update();
    }, fail);
    return () => { cancelled = true; stopRequirements(); stopConfirmations(); };
  }, [scope, uid, cloud, localKey]);

  const contexts = data && sameIdentity ? data.members.filter(member => member.active !== false).map(member => [member.id, readinessContext(data, stored.requirements, member.id, scope)] as const) : [];
  const signature = JSON.stringify(contexts);
  useEffect(() => {
    let cancelled = false;
    const identity = current.current;
    void Promise.all(contexts.map(async ([id, context]) => [id, await hashReadinessContext(context)] as const)).then(values => {
      if (!cancelled && current.current === identity) setHashes({ signature, values: Object.fromEntries(values) });
    }).catch(failure => { if (!cancelled && current.current === identity) { setHashes({ signature: '', values: {} }); setError(readinessError(failure, 'hash')); } });
    return () => { cancelled = true; };
    // signature is the complete canonical input, including scope-reset member data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, scope, uid]);

  const calculated = data ? departureSummary(data, stored.requirements, stored.confirmations, hashes.signature === signature ? hashes.values : {}) : null;
  const self = data ? linkedReadinessMember(data, uid) : undefined;
  const selfStatus = calculated?.members.find(row => row.member.id === self?.id);
  const admin = !!data && (data.ownerUid === uid || data.adminUids.includes(uid));
  const disabled = !sameIdentity || !packingLoaded || !packingSynced || !loaded || pending || packingBusy || busy || readOnly || !data;
  const hashing = hashes.signature !== signature;

  async function save(next: StoredReadiness, remote: () => Promise<void>) {
    if (disabled || saving.current || !scope || !uid || current.current.scope !== scope || current.current.uid !== uid || cloud && auth?.currentUser?.uid !== uid) return;
    const identity = current.current;
    saving.current = true; setBusy(true); setError('');
    try {
      if (cloud) { if (!db) throw new Error('Firebase unavailable'); await remote(); }
      else { localStorage.setItem(localKey, JSON.stringify(next)); if (current.current === identity) setStored(next); }
    } catch (failure) { if (current.current === identity) setError(readinessError(failure, 'save')); }
    finally { if (current.current === identity) { saving.current = false; setBusy(false); } }
  }

  function toggleRequirement(itemId: string) {
    if (!admin || !data) return;
    const exists = stored.requirements.some(requirement => requirement.itemId === itemId);
    if (!exists && !data.items.some(item => item.id === itemId)) return;
    const requirement: DepartureRequirement = { itemId, createdBy: uid, createdAt: localTime() };
    const next = { ...stored, requirements: exists ? stored.requirements.filter(row => row.itemId !== itemId) : [...stored.requirements, requirement] };
    void save(next, () => exists ? deleteDoc(doc(db!, 'packingTrips', scope, 'departureRequirements', itemId)) : setDoc(doc(db!, 'packingTrips', scope, 'departureRequirements', itemId), { ...requirement, createdAt: serverTimestamp() }));
  }

  function confirm() {
    if (!self || !selfStatus || selfStatus.blocked.length || hashing) return;
    const confirmation: DepartureConfirmation = { uid, memberId: self.id, contextHash: hashes.values[self.id], confirmedAt: localTime() };
    const next = { ...stored, confirmations: [...stored.confirmations.filter(row => row.uid !== uid), confirmation] };
    void save(next, () => setDoc(doc(db!, 'packingTrips', scope, 'departureConfirmations', uid), { ...confirmation, confirmedAt: serverTimestamp() }));
  }

  function undo() {
    void save({ ...stored, confirmations: stored.confirmations.filter(row => row.uid !== uid) }, () => deleteDoc(doc(db!, 'packingTrips', scope, 'departureConfirmations', uid)));
  }

  const synced = loaded && packingLoaded && packingSynced && !pending && !packingBusy && !hashing && sameIdentity;
  const displayReady = !!calculated?.ready && synced;
  return <section className="departure-readiness" aria-labelledby="departure-readiness-title">
    <div className="departure-heading"><div><h3 id="departure-readiness-title">{t('Departure readiness check')}</h3><p>{t('Choose essential items, pack them, then confirm your own readiness.')}</p></div><span className={`departure-badge ${displayReady ? 'is-ready' : ''}`} role="status">{t(displayReady ? 'Everyone is ready to depart' : 'Departure check in progress')}</span></div>
    {!cloud && <p className="departure-hint">{t('Demo readiness is saved on this device only.')}</p>}
    {error && <p className="notice" role="alert">{t(error)}</p>}
    {(!loaded || !packingLoaded) && !error && <p role="status">{t('Loading departure readiness…')}</p>}
    {data && sameIdentity && <>
      {admin && <fieldset className="departure-requirements" disabled={disabled}><legend>{t('Essential items before departure')}</legend><p>{t('Choose items already in the packing list, such as passport or tickets.')}</p>
        {!data.items.length && <p>{t('Add packing items first to select departure essentials.')}</p>}
        {data.items.map(item => <label key={item.id} className="departure-item-choice"><input type="checkbox" checked={stored.requirements.some(requirement => requirement.itemId === item.id)} onChange={() => toggleRequirement(item.id)}/><span>{packingItemName(item, t)}</span></label>)}
        {stored.requirements.filter(requirement => !data.items.some(item => item.id === requirement.itemId)).map(requirement => <div className="departure-item-choice" key={requirement.itemId}><span>{t('A required item was removed from the packing list.')}</span><button type="button" onClick={() => toggleRequirement(requirement.itemId)}>{t('Remove requirement')}</button></div>)}
      </fieldset>}
      {!stored.requirements.length && loaded && <p className="departure-hint">{t('No essential items selected. Members can still confirm their own readiness.')}</p>}
      {stored.requirements.length > 0 && <div className="departure-checks"><strong>{t('Essential checks packed: {packed} / {total}', { packed: calculated?.packed || 0, total: calculated?.total || 0 })}</strong>
        <ul>{stored.requirements.map(requirement => { const item = data.items.find(row => row.id === requirement.itemId); const rows = calculated?.checks.filter(check => check.itemId === requirement.itemId) || []; return <li key={requirement.itemId}><span>{item ? packingItemName(item, t) : t('Removed item')}</span><span>{t('Packed {packed} / {total}', { packed: rows.filter(row => row.packed).length, total: rows.length })}</span></li>; })}</ul>
      </div>}
      <ul className="departure-members">{calculated?.members.map(row => <li key={row.member.id}><strong>{row.member.name}</strong><span className={`departure-member-status ${row.confirmed && synced ? 'is-ready' : ''}`}>{t(!row.linked ? 'Account not linked' : !synced ? 'Waiting for readiness sync…' : row.blocked.length ? 'Essential packing incomplete' : row.confirmed ? 'Ready to depart' : row.stale ? 'Check changed — confirm again' : 'Awaiting personal confirmation')}</span></li>)}</ul>
      {!self && <p className="departure-hint">{t('Your account must be linked to exactly one active packing member before you can confirm.')}</p>}
      {self && <div className="departure-actions">
        {!!selfStatus?.blocked.length && <p>{t('Pack your essential items and all shared essentials before confirming.')}</p>}
        {selfStatus?.confirmed ? <button type="button" disabled={disabled} onClick={undo}>{t('Undo my readiness confirmation')}</button> : <button type="button" className="primary" disabled={disabled || hashing || !!selfStatus?.blocked.length} onClick={confirm}>{t('I am ready to depart')}</button>}
      </div>}
      {(busy || pending || packingLoaded && !packingSynced) && <p role="status">{t(busy ? 'Saving departure readiness…' : packingLoaded && !packingSynced ? 'Waiting for packing sync…' : 'Waiting for readiness sync…')}</p>}
      {readOnly && <p className="departure-hint">{t('Departure readiness is read-only for this trip.')}</p>}
      <p className="departure-hint">{t('Changing essential items, members or relevant packing checks requires a new confirmation.')}</p>
    </>}
  </section>;
}
