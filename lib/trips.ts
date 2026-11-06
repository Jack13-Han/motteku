import type { Timestamp } from 'firebase/firestore';

export type TripStatus = 'draft' | 'recruiting' | 'confirmed' | 'completed';
export type TripMemberRole = 'owner' | 'admin' | 'member';
export type TripType = 'camping' | 'domestic' | 'overseas' | 'hiking' | 'beach' | 'other';
export interface Trip {
  id: string; name: string; type: TripType; destination: string; startDate: string; endDate: string;
  description: string; plannedMemberCount: number; joinedMemberCount: number;
  ownerUid: string; ownerName: string; status: TripStatus; activeInviteId: string;
  confirmedMemberIds: string[]; packingReady: boolean; createdAt: Timestamp; updatedAt: Timestamp;
}
export interface TripMember {
  id: string; uid: string; tripId: string; name: string; role: TripMemberRole;
  invitationId: string; joinedAt: Timestamp;
}
export type TripInput = Pick<Trip, 'name' | 'type' | 'destination' | 'startDate' | 'endDate' | 'description' | 'plannedMemberCount'>;
export type InvitationPreview = Pick<Trip, 'name' | 'destination' | 'startDate' | 'endDate' | 'ownerName' | 'plannedMemberCount' | 'joinedMemberCount'>;
export interface TripInvitation {
  id: string; tripId: string; code: string; createdBy: string; expiresAt: Timestamp;
  maxUses?: number; usedCount: number; isActive: boolean; createdAt: Timestamp; preview: InvitationPreview;
}
export const tripTypeLabels: Record<TripType, string> = { camping: 'Camping', domestic: 'Domestic travel', overseas: 'Overseas travel', hiking: 'Hiking', beach: 'Beach', other: 'Other' };
export const templateTripTypes: Record<TripType, string> = { camping: 'Camping', domestic: 'Domestic travel', overseas: 'Overseas travel', hiking: 'Hiking', beach: 'Beach', other: 'Other' };
export function validateTrip(input: TripInput) {
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!input.name.trim() || input.name.trim().length > 200 || !input.destination.trim() || input.destination.length > 200 || input.description.length > 2000 || !Object.hasOwn(tripTypeLabels, input.type) || !validDay(input.startDate) || !validDay(input.endDate) || input.endDate < input.startDate || !Number.isSafeInteger(input.plannedMemberCount) || input.plannedMemberCount < 1 || input.plannedMemberCount > 100) throw new Error('Check the trip details and use a planned size between 1 and 100.');
}
export function normalizeInviteCode(value: string) { return value.trim().replace(/-/g, '').toUpperCase(); }
export function invitationUsable(invite: TripInvitation, now = Date.now()) {
  return invite.isActive && invite.expiresAt.toMillis() > now && invite.usedCount < (invite.maxUses ?? 99);
}
export function safeReturnPath(value: string | null) {
  return value && /^\/(?:join\/[A-Za-z0-9-]+|trips(?:\/[A-Za-z0-9_-]+)?)$/.test(value) ? value : '/';
}
