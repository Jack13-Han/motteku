'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from './firebase';
import type { Trip, TripInvitation, TripMember } from './trips';

export function useTripAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!auth) { setReady(true); return; }
    return onAuthStateChanged(auth, current => { setUser(current && !current.isAnonymous ? current : null); setReady(true); });
  }, []);
  return { user, ready, configured: firebaseConfigured };
}

export function useManagedTrip(id: string, uid: string) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [invitation, setInvitation] = useState<TripInvitation | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setTrip(null); setMembers([]); setLoaded(false); setError('');
    if (!uid || !db) return;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) { setError('Trip could not be loaded.'); return; }
    let tripReady = false, membersReady = false;
    const fail = () => { setLoaded(false); setError('Trip could not be loaded. Check membership and Firestore rules.'); };
    const stopTrip = onSnapshot(doc(db, 'trips', id), snap => {
      if (!snap.exists()) { fail(); return; }
      setTrip(snap.data() as Trip); tripReady = true; setLoaded(tripReady && membersReady);
    }, fail);
    const stopMembers = onSnapshot(collection(db, 'trips', id, 'tripMembers'), snap => {
      setMembers(snap.docs.map(member => member.data() as TripMember)); membersReady = true; setLoaded(tripReady && membersReady);
    }, fail);
    return () => { stopTrip(); stopMembers(); };
  }, [id, uid]);
  useEffect(() => {
    setInvitation(null);
    if (!db || !uid || !trip?.activeInviteId || !members.some(member => member.uid === uid && member.role !== 'member')) return;
    return onSnapshot(doc(db, 'tripInvitations', trip.activeInviteId), snap => setInvitation(snap.exists() ? snap.data() as TripInvitation : null), () => setError('Could not load the invitation.'));
  }, [trip?.activeInviteId, uid, members]);
  return { trip, members, invitation, error, setError, loaded };
}
