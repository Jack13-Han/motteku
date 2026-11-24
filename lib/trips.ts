import type { Timestamp } from 'firebase/firestore';

export type TripStatus = 'draft' | 'recruiting' | 'confirmed' | 'completed';
export type TripMemberRole = 'owner' | 'admin' | 'member';
export type TripType = 'camping' | 'domestic' | 'overseas' | 'hiking' | 'beach' | 'other';
export type TripMode = 'single' | 'group';
export type PackingPhase = 'personal' | 'shared';
export interface Trip {
  id: string; name: string; type: TripType; destination: string; startDate: string; endDate: string;
  mode?: TripMode; packingPhase?: PackingPhase;
  tripDetailsReady?: boolean;
  description: string; plannedMemberCount: number; joinedMemberCount: number;
  ownerUid: string; ownerName: string; status: TripStatus; activeInviteId: string;
  confirmedMemberIds: string[]; packingReady: boolean; createdAt: Timestamp; updatedAt: Timestamp;
}
export interface TripMember {
  id: string; uid: string; tripId: string; name: string; role: TripMemberRole;
  invitationId: string; joinedAt: Timestamp;
}
export type TripInput = Pick<Trip, 'name' | 'type' | 'destination' | 'startDate' | 'endDate' | 'description' | 'plannedMemberCount'> & { mode: TripMode };
export type InvitationPreview = Pick<Trip, 'name' | 'destination' | 'startDate' | 'endDate' | 'ownerName' | 'plannedMemberCount' | 'joinedMemberCount'> & { tripDetailsReady?: boolean };
export interface TripInvitation {
  id: string; tripId: string; code: string; createdBy: string; expiresAt: Timestamp;
  maxUses?: number; usedCount: number; isActive: boolean; createdAt: Timestamp; preview: InvitationPreview;
}
export const tripTypeLabels: Record<TripType, string> = { camping: 'Camping', domestic: 'Domestic travel', overseas: 'Overseas travel', hiking: 'Hiking', beach: 'Beach', other: 'Other' };
export const templateTripTypes: Record<TripType, string> = { camping: 'Camping', domestic: 'Domestic travel', overseas: 'Overseas travel', hiking: 'Hiking', beach: 'Beach', other: 'Other' };
export function validateTrip(input: TripInput, allowPendingGroupDetails = false) {
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const pending = allowPendingGroupDetails && input.mode === 'group' && !input.destination && !input.startDate && !input.endDate && !input.description;
  if (!input.name.trim() || input.name.trim().length > 200 || (!pending && (!input.destination.trim() || input.destination.length > 200 || !validDay(input.startDate) || !validDay(input.endDate) || input.endDate < input.startDate)) || input.description.length > 2000 || !Object.hasOwn(tripTypeLabels, input.type) || !['single', 'group'].includes(input.mode) || !Number.isSafeInteger(input.plannedMemberCount) || input.plannedMemberCount < 1 || input.plannedMemberCount > 100 || (input.mode === 'single' && input.plannedMemberCount !== 1) || (input.mode === 'group' && input.plannedMemberCount < 2)) throw new Error('Check the trip details and use a planned size between 1 and 100.');
}
export function normalizeInviteCode(value: string) { return value.trim().replace(/-/g, '').toUpperCase(); }
export function invitationUsable(invite: TripInvitation, now = Date.now()) {
  return invite.isActive && invite.expiresAt.toMillis() > now && invite.usedCount < (invite.maxUses ?? 99);
}
export function safeReturnPath(value: string | null) {
  return value && /^\/(?:join\/[A-Za-z0-9-]+|trips(?:\/[A-Za-z0-9_-]+)?)$/.test(value) ? value : '/';
}
