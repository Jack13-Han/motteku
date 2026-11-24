'use client';

import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { usePacking } from './usePacking';
import { reportTravelCheckFailure, travelCheckFailureNotice, travelCheckPaths } from './travelCheckErrors';
import { canEditCheckItem, checkpointDefinitions, checkProgress, initialTravelPlan, readTravelCheck, reconcileCheckSchedules, snapshotPackedAssignments, storeTravelCheck, validateTravelPlan, type StoredTravelCheckpoint, type TravelCheckpoint, type TravelCheckItemStatus, type TravelCheckPlan, type TravelTripSettings } from './travelChecks';

export function useTravelChecks(scope: string, tripId: string, uid: string, packing: ReturnType<typeof usePacking>, trip: TravelTripSettings & { startDate: string; endDate: string }) {
  const [checks, setChecks] = useState<TravelCheckpoint[]>([]);
  const [savedPlan, setPlan] = useState<TravelCheckPlan | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [parentReady, setParentReady] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saving = useRef(false), currentContext = useRef('');
  const operationId = useRef(0);
  const contextKey = `${uid}:${scope}:${tripId}`;
  currentContext.current = contextKey;
  const localKey = `motteku-travel-checks:${scope}`;
  const paths = travelCheckPaths(scope);
  const data = packing.data;
  const manager = !!data && !!uid && (data.ownerUid === uid || data.adminUids.includes(uid));
  const plan = (loadedKey === contextKey ? savedPlan : null) || initialTravelPlan(trip);
  const loaded = !!scope && loadedKey === contextKey && packing.loaded;
  const visibleChecks = loaded ? checks : [];
  // Schedule previews are virtual until the user explicitly saves or starts.
  const availableChecks = loaded ? reconcileCheckSchedules(checks, checkpointDefinitions(tripId, plan)) : [];

  function diagnose(failure: unknown, operation: string, documentPath: string) {
    return reportTravelCheckFailure(failure, { operation, documentPath, currentUserUid: auth?.currentUser?.uid || null, requestedUid: uid, tripId, packingScope: scope, projectId: db?.app?.options.projectId });
  }

  useEffect(() => {
    operationId.current++; saving.current = false;
    setChecks([]); setPlan(null); setLoadedKey(''); setParentReady(false); setError(''); setBusy(false);
    if (!scope || scope.includes('/') || !tripId || !packing.loaded || !packing.data || !uid) return;
    let cancelled = false, subscription = 0;
    let stopChildren: (() => void)[] = [];
    const clearChildren = () => { subscription++; stopChildren.forEach(stop => stop()); stopChildren = []; };
    const fail = (failure: unknown, operation: string, path: string, attempt: number) => {
      if (cancelled || attempt !== subscription || currentContext.current !== contextKey) return;
      const details = reportTravelCheckFailure(failure, { operation, documentPath: path, currentUserUid: auth?.currentUser?.uid || null, requestedUid: uid, tripId, packingScope: scope, projectId: db?.app?.options.projectId });
      setError(travelCheckFailureNotice(details.code));
    };
    if (!packing.cloud) {
      try {
        const saved = JSON.parse(localStorage.getItem(localKey) || 'null');
        setChecks(saved?.checks || []); setPlan(saved?.plan || null); setParentReady(true); setLoadedKey(contextKey);
      } catch (failure) { fail(failure, 'read-local', localKey, subscription); }
      return () => { cancelled = true; };
    }
    if (!db || !auth) { setError('Your sign-in is not ready or has expired. Sign in again and retry.'); return; }
    const database = db, authentication = auth;
    const stopAuth = onAuthStateChanged(authentication, user => {
      if (cancelled || currentContext.current !== contextKey) return;
      clearChildren();
      const attempt = subscription;
      setChecks([]); setPlan(null); setLoadedKey(''); setParentReady(false);
      if (!user || user.uid !== uid) return;
      void (async () => {
        // A cached packing.loaded flag is insufficient during account/scope changes.
        const parent = await getDocFromServer(doc(database, paths.parent));
        if (cancelled || attempt !== subscription || currentContext.current !== contextKey || authentication.currentUser?.uid !== uid) return;
        if (!parent.exists()) {
          setChecks([]); setPlan(null); setLoadedKey(contextKey);
          setError('Packing data is not ready yet. Finish loading the trip, then retry.');
          return;
        }
        setParentReady(true);
        let checksReady = false, planReady = false, readFailed = false;
        const publish = () => { if (!cancelled && attempt === subscription && currentContext.current === contextKey && checksReady && planReady) { setLoadedKey(contextKey); if (!readFailed) setError(''); } };
        const listenerError = (failure: unknown, operation: string, path: string) => { readFailed = true; fail(failure, operation, path, attempt); };
        stopChildren.push(onSnapshot(collection(database, paths.checkpoints), { includeMetadataChanges: true }, snapshot => {
          if (cancelled || attempt !== subscription || currentContext.current !== contextKey || snapshot.metadata.hasPendingWrites) return;
          setChecks(snapshot.docs.map(value => readTravelCheck(value.data() as StoredTravelCheckpoint))); checksReady = true; publish();
        }, failure => listenerError(failure, 'listen-checkpoints', paths.checkpoints)));
        stopChildren.push(onSnapshot(doc(database, paths.plan), { includeMetadataChanges: true }, snapshot => {
          if (cancelled || attempt !== subscription || currentContext.current !== contextKey || snapshot.metadata.hasPendingWrites) return;
          // Missing documents are successful empty snapshots, not Firebase errors.
          setPlan(snapshot.exists() ? snapshot.data() as TravelCheckPlan : null); planReady = true; publish();
        }, failure => listenerError(failure, 'listen-plan', paths.plan)));
      })().catch(failure => fail(failure, 'read-parent', paths.parent, attempt));
    });
    return () => { cancelled = true; clearChildren(); stopAuth(); };
    // Dates alter the virtual plan, not the identity of Firestore subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, uid, tripId, packing.loaded, packing.cloud, localKey, contextKey, retryVersion]);

  async function run(action: () => Promise<void>, operation: string, documentPath: string) {
    if (currentContext.current !== contextKey) return false;
    if (packing.cloud && auth?.currentUser?.uid !== uid) { setError('Your sign-in is not ready or has expired. Sign in again and retry.'); return false; }
    if (!loaded || !parentReady || saving.current || packing.busy) return false;
    const operationContext = contextKey, token = ++operationId.current;
    saving.current = true; setBusy(true); setError('');
    try { await action(); return currentContext.current === operationContext && token === operationId.current; }
    catch (failure) {
      const validation = failure instanceof Error && ['Select a current bag before marking an item as packed.', 'Resolve unchecked and missing items before completing the check.', 'Only the trip owner or an admin can manage checks.', 'No packed departure assignments are available yet.', 'This check is already completed.'].includes(failure.message) ? failure.message : '';
      const details = validation ? null : diagnose(failure, operation, documentPath);
      if (currentContext.current === operationContext && token === operationId.current) setError(validation || (details && details.code !== 'unknown' ? travelCheckFailureNotice(details.code) : 'Could not save the item check. Please try again.'));
      return false;
    } finally { if (token === operationId.current) { saving.current = false; if (currentContext.current === operationContext) setBusy(false); } }
  }
  function saveLocal(nextChecks: TravelCheckpoint[], nextPlan: TravelCheckPlan | null = savedPlan) {
    localStorage.setItem(localKey, JSON.stringify({ checks: nextChecks, plan: nextPlan }));
    setChecks(nextChecks); setPlan(nextPlan); window.dispatchEvent(new Event('motteku-travel-checks'));
  }
  function loadLocal(): TravelCheckpoint[] { return JSON.parse(localStorage.getItem(localKey) || 'null')?.checks || []; }

  async function savePlan(nextPlan: TravelCheckPlan) {
    const problem = validateTravelPlan(nextPlan, trip.startDate, trip.endDate);
    if (problem) { setError(problem); return false; }
    if (!manager) return false;
    return run(async () => {
      const definitions = checkpointDefinitions(tripId, nextPlan);
      if (!packing.cloud) { saveLocal(reconcileCheckSchedules(loadLocal(), definitions), nextPlan); return; }
      if (!db) throw new Error('Firebase is not connected.');
      const database = db;
      const ids = [...new Set([...checks.map(check => check.id), ...definitions.map(check => check.id)])];
      await runTransaction(database, async transaction => {
        const refs = ids.map(id => doc(database, paths.checkpoints, id));
        const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
        const existing = snapshots.filter(value => value.exists()).map(value => readTravelCheck(value.data() as StoredTravelCheckpoint));
        for (const check of reconcileCheckSchedules(existing, definitions)) {
          if (JSON.stringify(existing.find(value => value.id === check.id)) !== JSON.stringify(check)) transaction.set(doc(database, paths.checkpoints, check.id), storeTravelCheck(check));
        }
        transaction.set(doc(database, paths.plan), nextPlan);
      });
    }, 'save-plan', paths.plan);
  }

  async function updateCheck(id: string, change: (check: TravelCheckpoint) => TravelCheckpoint, lastUpdatedItemId = '', create?: TravelCheckpoint) {
    return run(async () => {
      if (!packing.cloud) {
        const current = loadLocal(), previous = current.find(check => check.id === id) || create;
        if (!previous) throw new Error('Trip could not be loaded.');
        const next = change(previous);
        saveLocal(current.some(check => check.id === id) ? current.map(check => check.id === id ? next : check) : [...current, next]); return;
      }
      if (!db) throw new Error('Firebase is not connected.');
      const ref = doc(db, paths.checkpoints, id);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists() ? readTravelCheck(snapshot.data() as StoredTravelCheckpoint) : create;
        if (!current) throw new Error('Trip could not be loaded.');
        const next = change(current);
        if (next !== current) transaction.set(ref, { ...storeTravelCheck(next), lastUpdatedItemId });
      });
    }, create ? 'start-check' : 'update-check', `${paths.checkpoints}/${id}`);
  }
  return { checks: visibleChecks, availableChecks, plan, loaded, busy, error, manager, readyForWrites: loaded && parentReady,
    retry: () => setRetryVersion(value => value + 1),
    savePlan,
    start: (id: string) => updateCheck(id, check => {
      if (!manager || !data) throw new Error('Only the trip owner or an admin can manage checks.');
      if (check.snapshotAt) return check;
      const items = snapshotPackedAssignments(data);
      if (!items.length) throw new Error('No packed departure assignments are available yet.');
      return { ...check, items, snapshotAt: new Date().toISOString(), status: 'inProgress' };
    }, '', checkpointDefinitions(tripId, plan).find(check => check.id === id)),
    updateItem: (id: string, itemId: string, status: TravelCheckItemStatus, bagId: string) => updateCheck(id, check => {
      if (check.status === 'completed') throw new Error('This check is already completed.');
      const item = check.items.find(value => value.id === itemId);
      if (!item || !data || !canEditCheckItem(data, uid, item)) throw new Error('Only the trip owner or an admin can manage checks.');
      const bag = data.bags.find(value => value.id === bagId);
      if (status === 'packed' && !bag) throw new Error('Select a current bag before marking an item as packed.');
      return { ...check, status: 'inProgress', items: check.items.map(value => value.id === itemId ? { ...value, status, currentBagId: bag?.id || '', currentBagName: bag?.name || '', updatedAt: new Date().toISOString() } : value) };
    }, itemId),
    complete: (id: string) => updateCheck(id, check => {
      if (!manager) throw new Error('Only the trip owner or an admin can manage checks.');
      if (!check.snapshotAt || checkProgress(check).unresolved.length) throw new Error('Resolve unchecked and missing items before completing the check.');
      return { ...check, status: 'completed', completedAt: new Date().toISOString() };
    }),
  };
}
export type TravelCheckController = ReturnType<typeof useTravelChecks>;
