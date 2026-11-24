export function travelCheckPaths(scope: string) {
  const parent = `packingTrips/${scope}`;
  return { parent, checkpoints: `${parent}/travelCheckpoints`, plan: `${parent}/travelCheckPlans/current` };
}

export type TravelCheckErrorContext = {
  operation: string; documentPath: string; currentUserUid: string | null;
  requestedUid: string; tripId: string; packingScope: string; projectId?: string;
};

export function travelCheckFailure(failure: unknown, context: TravelCheckErrorContext) {
  const value = failure as { code?: string; message?: string } | null;
  return { code: value?.code || 'unknown', message: value?.message || String(failure), ...context };
}

export function reportTravelCheckFailure(failure: unknown, context: TravelCheckErrorContext) {
  const details = travelCheckFailure(failure, context);
  // Temporary development diagnostics preserve the SDK failure without feeding
  // a recoverable listener error into Next's console.error overlay.
  if (process.env.NODE_ENV !== 'production') console.warn('[travel-checks] Firebase operation failed', details);
  return details;
}

export function travelCheckFailureNotice(code: string): string {
  const normalized = code.replace(/^firestore\//, '');
  if (normalized === 'permission-denied') return 'Item check access was denied. Check trip membership and deploy the updated Firestore Rules, then retry.';
  if (normalized === 'unauthenticated' || normalized.startsWith('auth/')) return 'Your sign-in is not ready or has expired. Sign in again and retry.';
  if (normalized === 'unavailable' || normalized === 'deadline-exceeded') return 'Item checks could not connect. Check your connection and retry.';
  return 'Could not load item checks. Please retry.';
}
