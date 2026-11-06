import { collection, doc, getDoc, increment, runTransaction, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import { invitationUsable, normalizeInviteCode, validateTrip, type Trip, type TripInput, type TripInvitation, type TripMemberRole } from './trips';

function database(): Firestore { if (!db) throw new Error('Firebase Authentication is not configured. Check your Firebase project settings.'); return db; }
function account(user: User | null): User { if (!user || user.isAnonymous) throw new Error('Sign in with an account to manage trips.'); return user; }
export function accountName(user: User) { return (user.displayName?.trim() || user.email?.split('@')[0] || user.uid).slice(0, 200); }
export async function createDraftTrip(input: TripInput, current: User | null) {
  validateTrip(input);
  const user = account(current), db = database(), ref = doc(collection(db, 'trips'));
  const name = accountName(user);
  await runTransaction(db, async tx => {
    tx.set(ref, { ...input, name: input.name.trim(), destination: input.destination.trim(), id: ref.id, ownerUid: user.uid, ownerName: name, status: 'draft', joinedMemberCount: 1, activeInviteId: '', confirmedMemberIds: [], packingReady: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(doc(ref, 'tripMembers', user.uid), { id: user.uid, uid: user.uid, tripId: ref.id, name, role: 'owner', invitationId: '', joinedAt: serverTimestamp() });
    tx.set(doc(db, 'users', user.uid, 'tripMemberships', ref.id), { tripId: ref.id, uid: user.uid, joinedAt: serverTimestamp() });
    const parent = doc(db, 'packingTrips', ref.id);
    tx.set(parent, { managedTripId: ref.id, sourceTripId: ref.id, roomId: '', ownerUid: user.uid, adminUids: [], bags: [], bagIds: [], createdAt: serverTimestamp() });
    tx.set(doc(parent, 'members', user.uid), { id: user.uid, uid: user.uid, name, active: true });
  });
  return ref.id;
}
export async function issueInvitation(tripId: string, current: User | null) {
  const user = account(current), db = database();
  // 80 random bits; display groups are formatting only. No list access to the invite collection.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  const code = id.match(/.{1,4}/g)!.join('-');
  const ref = doc(db, 'trips', tripId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref); if (!snap.exists()) throw new Error('Trip could not be loaded.');
    const trip = snap.data() as Trip;
    const invitation = doc(db, 'tripInvitations', id);
    if ((await tx.get(invitation)).exists()) throw new Error('Could not create an invitation. Please try again.');
    if (trip.status === 'completed') throw new Error('This trip is completed.');
    if (trip.activeInviteId) tx.update(doc(db, 'tripInvitations', trip.activeInviteId), { isActive: false });
    const { name, destination, startDate, endDate, ownerName, plannedMemberCount, joinedMemberCount } = trip;
    tx.set(invitation, { id, code, tripId, createdBy: user.uid, usedCount: 0, maxUses: 99, isActive: true, expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000), createdAt: serverTimestamp(), preview: { name, destination, startDate, endDate, ownerName, plannedMemberCount, joinedMemberCount } });
    tx.update(ref, { activeInviteId: id, status: trip.status === 'draft' ? 'recruiting' : trip.status, updatedAt: serverTimestamp() });
  });
  return id;
}
export async function disableInvitation(tripId: string) {
  const db = database(), ref = doc(db, 'trips', tripId);
  await runTransaction(db, async tx => {
    const trip = (await tx.get(ref)).data() as Trip;
    if (trip.activeInviteId) tx.update(doc(db, 'tripInvitations', trip.activeInviteId), { isActive: false });
    tx.update(ref, { activeInviteId: '', updatedAt: serverTimestamp() });
  });
}
export async function readInvitation(raw: string) {
  const snap = await getDoc(doc(database(), 'tripInvitations', normalizeInviteCode(raw)));
  if (!snap.exists() || !invitationUsable(snap.data() as TripInvitation)) throw new Error('This invitation is invalid, expired or full.');
  return snap.data() as TripInvitation;
}
export async function joinTrip(raw: string, current: User | null) {
  const user = account(current), db = database(), id = normalizeInviteCode(raw);
  return runTransaction(db, async tx => {
    const inviteRef = doc(db, 'tripInvitations', id), snap = await tx.get(inviteRef);
    if (!snap.exists()) throw new Error('This invitation is invalid, expired or full.');
    const invite = snap.data() as TripInvitation;
    if (!invitationUsable(invite)) throw new Error('This invitation is invalid, expired or full.');
    const tripRef = doc(db, 'trips', invite.tripId), memberRef = doc(tripRef, 'tripMembers', user.uid);
    // The member document is readable by its prospective owner even before joining.
    if ((await tx.get(memberRef)).exists()) throw new Error('You have already joined this trip.');
    // Only invitation projection is readable until membership is committed; Rules validate the trip increment.
    tx.set(memberRef, { id: user.uid, uid: user.uid, tripId: invite.tripId, name: accountName(user), role: 'member', invitationId: id, joinedAt: serverTimestamp() });
    tx.set(doc(db, 'users', user.uid, 'tripMemberships', invite.tripId), { tripId: invite.tripId, uid: user.uid, joinedAt: serverTimestamp() });
    tx.update(inviteRef, { usedCount: increment(1), 'preview.joinedMemberCount': increment(1) });
    // Server transforms keep counters atomic without exposing the private trip before membership.
    tx.update(tripRef, { joinedMemberCount: increment(1), updatedAt: serverTimestamp() });
    return invite.tripId;
  });
}
export async function confirmMembers(tripId: string, memberIds: string[], initial: boolean) {
  const db = database(), ref = doc(db, 'trips', tripId);
  await runTransaction(db, async tx => {
    const trip = (await tx.get(ref)).data() as Trip;
    if (initial && trip.status === 'confirmed') throw new Error('Members changed. Review the list again.');
    if (trip.joinedMemberCount !== memberIds.length || new Set(memberIds).size !== memberIds.length) throw new Error('Members changed. Review the list again.');
    const members = await Promise.all(memberIds.map(id => tx.get(doc(ref, 'tripMembers', id))));
    if (members.some(member => !member.exists())) throw new Error('Members changed. Review the list again.');
    tx.update(ref, { status: 'confirmed', confirmedMemberIds: memberIds, packingReady: false, updatedAt: serverTimestamp() });
  });
}
export async function markPackingReady(tripId: string, expectedIds: string[]) {
  const db = database(), ref = doc(db, 'trips', tripId);
  await runTransaction(db, async tx => {
    const trip = (await tx.get(ref)).data() as Trip;
    if (JSON.stringify(trip.confirmedMemberIds) !== JSON.stringify(expectedIds)) throw new Error('Members changed. Review the list again.');
    tx.update(ref, { packingReady: true, updatedAt: serverTimestamp() });
  });
}
export async function setMemberRole(tripId: string, uid: string, role: Exclude<TripMemberRole, 'owner'>) {
  const db = database();
  await runTransaction(db, async tx => { tx.update(doc(db, 'trips', tripId, 'tripMembers', uid), { role }); });
}
export async function completeTrip(tripId: string) {
  const db = database();
  await runTransaction(db, async tx => { tx.update(doc(db, 'trips', tripId), { status: 'completed', updatedAt: serverTimestamp() }); });
}
