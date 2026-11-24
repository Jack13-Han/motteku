'use client';
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase';
import { readTravelCheck, type StoredTravelCheckpoint, type TravelCheckpoint } from './travelChecks';

export function useTravelCheckReminders(trips: { id: string; sharedChatId?: string }[], accountId: string) {
  const uid = accountId === 'local' ? 'local-owner' : accountId;
  const scopes = [...new Set(trips.map(trip => trip.sharedChatId || `${uid}_${trip.id}`))];
  const signature = JSON.stringify(scopes);
  const key = `${accountId}:${signature}`;
  const [state, setState] = useState<{ key: string; values: { scope: string; check: TravelCheckpoint }[] }>({ key: '', values: [] });
  useEffect(() => {
    let cancelled = false;
    const values = new Map<string, TravelCheckpoint[]>();
    const publish = () => { if (!cancelled) setState({ key, values: [...values].flatMap(([scope, checks]) => checks.map(check => ({ scope, check }))) }); };
    const currentScopes = JSON.parse(signature) as string[];
    if (!firebaseConfigured) {
      const load = () => { for (const scope of currentScopes) { try { values.set(scope, JSON.parse(localStorage.getItem(`motteku-travel-checks:${scope}`) || 'null')?.checks || []); } catch { values.set(scope, []); } } publish(); };
      load(); window.addEventListener('storage', load); window.addEventListener('motteku-travel-checks', load);
      return () => { cancelled = true; window.removeEventListener('storage', load); window.removeEventListener('motteku-travel-checks', load); };
    }
    if (!db || accountId === 'local') return;
    const database = db;
    const stops = currentScopes.map(scope => onSnapshot(collection(database, 'packingTrips', scope, 'travelCheckpoints'), snapshot => {
      values.set(scope, snapshot.docs.map(value => readTravelCheck(value.data() as StoredTravelCheckpoint))); publish();
    }, () => { values.set(scope, []); publish(); }));
    return () => { cancelled = true; stops.forEach(stop => stop()); };
  }, [accountId, signature, key]);
  return state.key === key ? state.values : [];
}
