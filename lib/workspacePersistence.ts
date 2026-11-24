import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { convertPendingPacking, replaceWorkspaceTrip, type WorkspaceDocument, type WorkspaceTrip } from './workspacePacking';

export function logWorkspaceError(error: unknown, uid: string, tripId: string, payload: unknown) {
  const firebaseError = error as { code?: string; message?: string };
  console.error('Workspace persistence failed', { code: firebaseError?.code || 'unknown', message: firebaseError?.message || String(error), tripId, path: `users/${uid}/workspace/main`, rejectedPayload: payload, error });
}

/** Drop undefined object properties, but keep Firestore timestamps and other scalar objects. */
export function firestorePayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => firestorePayload(v)) as T;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => [key, firestorePayload(v)])) as T;
  return value;
}

export type WorkspaceRepository = {
  update: (change: (workspace: WorkspaceDocument) => WorkspaceDocument) => Promise<void>;
  reload: () => Promise<WorkspaceDocument>;
};

export function workspaceRepository(database: Firestore, uid: string, fallback: WorkspaceDocument): WorkspaceRepository {
  const parent = doc(database, 'users', uid, 'workspace', 'main');
  return {
    async update(change) {
      await runTransaction(database, async transaction => {
        const snapshot = await transaction.get(parent);
        const current = snapshot.exists() ? snapshot.data() as WorkspaceDocument : fallback;
        const next = firestorePayload(change(current));
        transaction.set(parent, next, { merge: true });
      });
    },
    async reload() {
      const saved = await getDocFromServer(parent);
      if (!saved.exists()) throw new Error('Trip could not be loaded.');
      return saved.data() as WorkspaceDocument;
    },
  };
}

/** Atomic conversion + server readback; never acknowledges success from optimistic local state. */
export async function initializeWorkspaceTrip(repository: WorkspaceRepository, uid: string, tripId: string, create?: WorkspaceTrip) {
  let payload: unknown = create;
  try {
    await repository.update(current => {
      payload = current;
      const next = replaceWorkspaceTrip(current, tripId, trip => {
        const converted = convertPendingPacking(trip, uid);
        if (!converted.items.length) throw new Error('Packing initialization produced no items.');
        return converted;
      }, create);
      payload = firestorePayload(create ? { ...next, activeTripId: tripId } : next);
      return payload as WorkspaceDocument;
    });
    const saved = await repository.reload();
    const trip = saved.trips.find(t => t.id === tripId);
    if (!trip?.items.length || trip.pendingPacking?.length) throw new Error('Packing initialization could not be verified.');
    return saved;
  } catch (error) {
    logWorkspaceError(error, uid, tripId, payload);
    throw error;
  }
}
