'use client';

import { useEffect, useRef, useState } from 'react';
import type { usePacking } from './usePacking';
import { firebaseConfigured } from './firebase';
import { mergeWorkspaceChanges, storeWorkspacePacking, workspacePackingData, type WorkspaceTrip } from './workspacePacking';
import { errorKey } from './messages';

/** Adapter for workspace/main trips. The managed-trip hook retains its separate existing backend. */
export function useWorkspacePacking(trip: WorkspaceTrip | undefined, uid: string, ready: boolean, changeTrip: (id: string, change: (trip: WorkspaceTrip) => WorkspaceTrip) => Promise<void>): ReturnType<typeof usePacking> {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const data = trip && ready && uid ? workspacePackingData(trip, uid) : null;
  const loaded = !!data && !trip?.pendingPacking?.length;
  useEffect(() => { setError(''); }, [trip?.id]);

  const mutate: ReturnType<typeof usePacking>['mutate'] = async local => {
    if (!trip || !loaded || saving.current) return false;
    saving.current = true; setBusy(true); setError('');
    try {
      await changeTrip(trip.id, current => storeWorkspacePacking(current, local(workspacePackingData(current, uid))));
      return true;
    } catch (failure) { setError(errorKey(failure, 'Could not save changes.')); return false; }
    finally { saving.current = false; setBusy(false); }
  };
  return { data, error, setError, busy, loaded, cloud: firebaseConfigured, roomMembers: [], mutate, storage: 'workspace',
    commitPlan: async next => data ? mutate(current => mergeWorkspaceChanges(data, next, current), () => {}) : false,
  };
}
