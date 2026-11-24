'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import { mergeWorkspaceChanges, type WorkspaceDocument, type WorkspaceTrip } from './workspacePacking';
import { initializeWorkspaceTrip, logWorkspaceError, workspaceRepository, type WorkspaceRepository } from './workspacePersistence';

export function useWorkspaceDocument<W extends WorkspaceDocument>(initial: W, uid: string, normalize: (value: any) => W) {
  const [workspace, setState] = useState(initial);
  const state = useRef(initial);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const queue = useRef<{ before: W; after: W }[]>([]);
  const running = useRef<Promise<void> | null>(null);
  const repository = useRef<WorkspaceRepository | null>(null);
  const generation = useRef(0);
  const publish = useCallback((value: WorkspaceDocument) => {
    const next = queue.current.reduce((current, operation) => mergeWorkspaceChanges(operation.before, operation.after, current), normalize(value));
    state.current = next; setState(next);
  }, [normalize]);

  useEffect(() => {
    const scope = ++generation.current;
    queue.current = []; running.current = null; repository.current = null;
    setReady(false); setError('');
    if (!firebaseConfigured) {
      const load = (): WorkspaceDocument => {
        const saved = localStorage.getItem('motteku-workspace');
        return saved ? JSON.parse(saved) : initial;
      };
      repository.current = {
        async update(change) { localStorage.setItem('motteku-workspace', JSON.stringify(change(load()))); },
        async reload() { return load(); },
      };
      try { publish(load()); setReady(true); } catch { setError('Could not read local data.'); }
      return;
    }
    if (!db || !uid) return;
    repository.current = workspaceRepository(db, uid, initial);
    return onSnapshot(doc(db, 'users', uid, 'workspace', 'main'), { includeMetadataChanges: true }, snapshot => {
      if (generation.current !== scope || snapshot.metadata.hasPendingWrites) return;
      publish(snapshot.exists() ? snapshot.data() as WorkspaceDocument : initial);
      setReady(true);
    }, failure => {
      logWorkspaceError(failure, uid, state.current.activeTripId, null);
      setError('Could not load the workspace. Check Firebase permissions.');
      setReady(true);
    });
    // Initial demo data is stable and must never reset an existing workspace on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, publish]);

  const flush = useCallback(async (): Promise<void> => {
    if (running.current) return running.current;
    const store = repository.current;
    if (!store) throw new Error('Waiting for Firebase sign-in.');
    const scope = generation.current;
    const job = (async () => {
      while (queue.current.length && generation.current === scope) {
        const operation = queue.current[0];
        let payload: unknown = operation.after;
        try {
          await store.update(current => {
            const next = mergeWorkspaceChanges(operation.before, operation.after, current as W);
            payload = next; return next;
          });
          if (generation.current !== scope) return;
          queue.current.shift();
          setError('');
        } catch (failure) {
          logWorkspaceError(failure, uid, operation.after.activeTripId, payload);
          setError('Could not save changes.');
          throw failure;
        }
      }
    })();
    running.current = job;
    try { await job; } finally { if (running.current === job) running.current = null; }
  }, [uid]);

  const setWorkspace = useCallback((update: SetStateAction<W>) => {
    const before = state.current;
    const after = typeof update === 'function' ? (update as (current: W) => W)(before) : update;
    if (after === before) return;
    queue.current.push({ before, after });
    state.current = after; setState(after);
    void flush().catch(() => { /* Error remains visible; retry on the next edit or initialization. */ });
  }, [flush]);

  const changeTrip = useCallback(async (tripId: string, change: (trip: WorkspaceTrip) => WorkspaceTrip) => {
    const store = repository.current;
    if (!store) throw new Error('Waiting for Firebase sign-in.');
    const scope = generation.current;
    await flush();
    if (scope !== generation.current || store !== repository.current) throw new Error('Workspace changed before saving.');
    let payload: unknown;
    try {
      await store.update(current => {
        if (!current.trips.some(trip => trip.id === tripId)) throw new Error('Trip could not be loaded.');
        const next = { ...current, trips: current.trips.map(trip => trip.id === tripId ? change(trip) : trip) };
        payload = next; return next;
      });
      const saved = await store.reload();
      if (scope !== generation.current) throw new Error('Workspace changed before saving.');
      publish(saved);
    } catch (failure) { logWorkspaceError(failure, uid, tripId, payload); throw failure; }
  }, [flush, publish, uid]);

  const initializeTrip = useCallback(async (tripId: string, create?: WorkspaceTrip) => {
    const store = repository.current;
    if (!store) throw new Error('Waiting for Firebase sign-in.');
    const scope = generation.current;
    await flush();
    if (scope !== generation.current || store !== repository.current) throw new Error('Workspace changed before saving.');
    const saved = await initializeWorkspaceTrip(store, uid || 'local-owner', tripId, create);
    if (scope !== generation.current) throw new Error('Workspace changed before saving.');
    publish(saved); setError('');
  }, [flush, publish, uid]);

  return { workspace, setWorkspace, ready, error, initializeTrip, changeTrip };
}
