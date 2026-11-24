'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import { errorKey } from './messages';
import { restorePackingData, type PackingBag, type PackingData, type PackingMember, type ItemAssignment, type TripItem } from './packing';

export function usePacking(scope: string, sourceTripId: string, roomId: string, uid: string, members: { id: string; name: string }[], bags: PackingBag[]) {
  const [data, setData] = useState<PackingData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dataScope, setDataScope] = useState('');
  const [dataUid, setDataUid] = useState('');
  const [syncState, setSyncState] = useState({ scope: '', uid: '', synced: false });
  const saving = useRef(false);
  const [roomMembers, setRoomMembers] = useState<{ uid: string; name: string }[]>([]);
  const cloud = firebaseConfigured;
  const localKey = `motteku-packing-v2:${scope}`;
  const sourceKey = JSON.stringify([scope, uid, cloud]);
  const source = useRef({ key: sourceKey });
  if (source.current.key !== sourceKey) source.current = { key: sourceKey };

  useEffect(() => {
    let cancelled = false;
    const identity = source.current;
    const active = () => !cancelled && source.current === identity;
    const unsubscribers: (() => void)[] = [];
    setData(null); setLoaded(false); setDataScope(''); setDataUid(''); setSyncState({ scope: '', uid: '', synced: false }); setError(''); setRoomMembers([]);
    if (!scope || !uid) return;
    const initial: PackingData = { ownerUid: uid, adminUids: [], bags, members: members.map(m => ({ ...m, uid: m.name === 'Me' ? uid : '' })), items: [], assignments: [] };
    if (!cloud) {
      try {
        const saved = localStorage.getItem(localKey);
        setData(saved ? restorePackingData(JSON.parse(saved)) : initial);
        setLoaded(true);
        setDataScope(scope);
        setDataUid(uid);
        setSyncState({ scope, uid, synced: true });
      } catch { setError("Could not read local data."); }
      return;
    }
    if (!db || !uid) { setError("Waiting for Firebase sign-in."); return; }
    const database = db;
    const parent = doc(database, 'packingTrips', scope);
    let failed = false;
    const fail = () => { if (active()) { failed = true; setLoaded(false); setSyncState({ scope, uid, synced: false }); setError("Could not load packing items. Check membership and Firestore rules."); } };
    void (async () => {
      try {
        const snapshot = await getDoc(parent);
        if (!active()) return;
        if (!snapshot.exists()) {
          if (roomId) {
            const room = await getDoc(doc(database, 'sharedTrips', roomId));
            if (!active()) return;
            if (room.data()?.ownerUid !== uid) throw new Error("The owner must initialize the packing list.");
          }
          await runTransaction(database, async transaction => {
            const existing = await transaction.get(parent);
            if (!active() || existing.exists()) return;
            transaction.set(parent, { sourceTripId, roomId, ownerUid: uid, adminUids: [], bags, bagIds: bags.map(b => b.id), createdAt: serverTimestamp() });
            initial.members.forEach(m => transaction.set(doc(parent, 'members', m.id), m));
          });
        }
        if (!active()) return;
        let parentReady = false, membersReady = false, itemsReady = false, assignmentsReady = false;
        const confirmed = { parent: false, members: false, items: false, assignments: false };
        const serverConfirmed = (snapshot: { metadata: { hasPendingWrites: boolean; fromCache: boolean } }) =>
          snapshot.metadata.hasPendingWrites === false && snapshot.metadata.fromCache === false;
        const values: PackingData = { ...initial, members: [], items: [], assignments: [] };
        const publish = () => {
          if (!active()) return;
          setData({ ...values });
          setDataScope(scope);
          setDataUid(uid);
          setLoaded(parentReady && membersReady && itemsReady && assignmentsReady);
          setSyncState({ scope, uid, synced: !failed && parentReady && membersReady && itemsReady && assignmentsReady && Object.values(confirmed).every(Boolean) });
        };
        unsubscribers.push(onSnapshot(parent, { includeMetadataChanges: true }, s => {
          if (!active()) return;
          const value = s.data();
          if (!value) { fail(); return; }
          values.ownerUid = value.ownerUid; values.adminUids = value.adminUids || []; values.bags = value.bags || [];
          parentReady = true; confirmed.parent = serverConfirmed(s); publish();
        }, fail));
        unsubscribers.push(onSnapshot(collection(parent, 'members'), { includeMetadataChanges: true }, s => { if (!active()) return; values.members = s.docs.map(d => d.data() as PackingMember); membersReady = true; confirmed.members = serverConfirmed(s); publish(); }, fail));
        unsubscribers.push(onSnapshot(collection(parent, 'items'), { includeMetadataChanges: true }, s => { if (!active()) return; values.items = s.docs.map(d => d.data() as TripItem); itemsReady = true; confirmed.items = serverConfirmed(s); publish(); }, fail));
        unsubscribers.push(onSnapshot(collection(parent, 'itemAssignments'), { includeMetadataChanges: true }, s => { if (!active()) return; values.assignments = s.docs.map(d => d.data() as ItemAssignment); assignmentsReady = true; confirmed.assignments = serverConfirmed(s); publish(); }, fail));
        if (roomId) unsubscribers.push(onSnapshot(collection(database, 'sharedTrips', roomId, 'members'), s => {
          if (!active()) return;
          setRoomMembers(s.docs.map(d => ({ uid: d.id, name: String(d.data().name || d.id) })));
        }, fail));
      } catch (e) { if (active()) { setSyncState({ scope, uid, synced: false }); setError(errorKey(e, 'Could not initialize packing items.')); } }
    })();
    return () => { cancelled = true; unsubscribers.forEach(unsubscribe => unsubscribe()); };
    // Roster and bags are refreshed explicitly, never overwrite another member's edits on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, uid, cloud]);

  async function mutate(local: (current: PackingData) => PackingData, remote: (batch: ReturnType<typeof writeBatch>, parent: ReturnType<typeof doc>) => void) {
    if (!data || !loaded || dataScope !== scope || dataUid !== uid || saving.current) return false;
    saving.current = true;
    setBusy(true); setError('');
    try {
      if (cloud) {
        if (!db) throw new Error("Firebase is not connected.");
        const batch = writeBatch(db);
        remote(batch, doc(db, 'packingTrips', scope));
        await batch.commit();
      } else {
        const next = local(data);
        localStorage.setItem(localKey, JSON.stringify(next));
        setData(next);
      }
      return true;
    } catch (e) { setError('Could not save changes.'); return false; }
    finally { saving.current = false; setBusy(false); }
  }

  /** Reconcile metadata and insert missing rows; never write an existing row's checks, assignee or bag. */
  async function commitPlan(next: PackingData) {
    if (!data || !loaded || dataScope !== scope || dataUid !== uid || saving.current) return false;
    saving.current = true; setBusy(true); setError('');
    try {
      if (!cloud) {
        localStorage.setItem(localKey, JSON.stringify(next));
        setData(next);
      } else {
        if (!db) throw new Error('Firebase is not connected.');
        const database = db;
        const parent = doc(database, 'packingTrips', scope);
        const changedMembers = next.members.filter(m => JSON.stringify(m) !== JSON.stringify(data.members.find(old => old.id === m.id)));
        // Small transactions keep Rules document-access usage bounded even for large groups.
        for (let offset = 0; offset < changedMembers.length; offset += 5) {
          const chunk = changedMembers.slice(offset, offset + 5);
          await runTransaction(database, async transaction => {
            const snapshots = await Promise.all(chunk.map(m => transaction.get(doc(parent, 'members', m.id))));
            chunk.forEach((m, index) => {
              const ref = doc(parent, 'members', m.id);
              if (snapshots[index].exists()) transaction.update(ref, { name: m.name, active: m.active !== false });
              else transaction.set(ref, m);
            });
          });
        }
        for (const item of next.items) {
          const old = data.items.find(i => i.id === item.id);
          if (old && old.quantity === item.quantity && JSON.stringify(old.targetMemberIds) === JSON.stringify(item.targetMemberIds)) continue;
          await runTransaction(database, async transaction => {
            const ref = doc(parent, 'items', item.id);
            if ((await transaction.get(ref)).exists()) transaction.update(ref, { quantity: item.quantity, targetMemberIds: item.targetMemberIds, updatedAt: serverTimestamp() });
            else transaction.set(ref, { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          });
        }
        const additions = next.assignments.filter(a => !data.assignments.some(old => old.id === a.id));
        for (let offset = 0; offset < additions.length; offset += 5) {
          const chunk = additions.slice(offset, offset + 5);
          await runTransaction(database, async transaction => {
            const snapshots = await Promise.all(chunk.map(a => transaction.get(doc(parent, 'itemAssignments', a.id))));
            chunk.forEach((a, index) => {
              if (!snapshots[index].exists()) transaction.set(doc(parent, 'itemAssignments', a.id), { ...a, updatedAt: serverTimestamp() });
            });
          });
        }
        if (JSON.stringify(next.bags) !== JSON.stringify(data.bags)) {
          const batch = writeBatch(database);
          batch.update(parent, { bags: next.bags, bagIds: next.bags.map(b => b.id) });
          await batch.commit();
        }
      }
      return true;
    } catch { setError('Could not save changes.'); return false; }
    finally { saving.current = false; setBusy(false); }
  }

  return { data, error, setError, busy, loaded: loaded && dataScope === scope && dataUid === uid, synced: loaded && dataScope === scope && dataUid === uid && syncState.scope === scope && syncState.uid === uid && syncState.synced, roomMembers, cloud, mutate, commitPlan, storage: 'collections' as 'collections' | 'workspace' };
}
