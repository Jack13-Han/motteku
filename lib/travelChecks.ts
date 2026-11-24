import { isCurrentAssignment, type PackingData } from './packing';

export type AccommodationMode = 'single' | 'multiple' | 'dayTrip';
export type TripStay = { id: string; name: string; checkInDate?: string; checkOutDate: string; checkOutTime: string; notificationMinutesBefore: number };
export type TravelTripSettings = { accommodationMode?: AccommodationMode; stays?: TripStay[] };
export type TravelCheckPlan = { accommodationMode: AccommodationMode; stays: TripStay[]; returnDate: string; returnTime: string; notificationMinutesBefore: number };
export type TravelCheckItemStatus = 'unchecked' | 'packed' | 'usedUp' | 'leaveBehind' | 'missing';
export type TravelCheckItem = {
  id: string; sourceItemId: string; sourceAssignmentId: string; itemName: string; itemNameKey: string;
  itemType: 'personal' | 'shared'; assigneeId: string; assigneeName: string; quantity: number;
  originalBagId: string; originalBagName: string; currentBagId: string; currentBagName: string;
  status: TravelCheckItemStatus; updatedAt: string;
};
export type TravelCheckpoint = {
  id: string; tripId: string; type: 'transition' | 'returnHome'; fromLocation: string; toLocation: string;
  scheduledAt: string; notificationMinutesBefore: number; status: 'upcoming' | 'inProgress' | 'completed';
  completedAt: string; snapshotAt: string; archived: boolean; items: TravelCheckItem[];
};
export type StoredTravelCheckpoint = Omit<TravelCheckpoint, 'items'> & { items: Record<string, TravelCheckItem>; unresolvedCount: number; missingCount: number; lastUpdatedItemId: string };
export const checkStatusLabels: Record<TravelCheckItemStatus, string> = { unchecked: 'Unchecked', packed: 'Packed', usedUp: 'Used up', leaveBehind: 'Leave behind', missing: 'Missing' };
export const accommodationLabels: Record<AccommodationMode, string> = { single: 'Stay at one location', multiple: 'Stay at multiple locations', dayTrip: 'Day trip' };
export const checkpointTitle = (check: Pick<TravelCheckpoint, 'type'>) => check.type === 'transition' ? 'Before-moving check' : 'Return-home check';
export function normalizeTravelSettings(trip: TravelTripSettings): Required<TravelTripSettings> {
  return { accommodationMode: ['single', 'multiple', 'dayTrip'].includes(trip.accommodationMode || '') ? trip.accommodationMode! : 'single', stays: Array.isArray(trip.stays) ? trip.stays : [] };
}
export function initialTravelPlan(trip: TravelTripSettings & { endDate: string }): TravelCheckPlan {
  return { ...normalizeTravelSettings(trip), returnDate: trip.endDate || '', returnTime: '09:00', notificationMinutesBefore: 60 };
}
export const validTravelDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateTravelPlan(plan: TravelCheckPlan, startDate: string, endDate: string): string {
  if (!['single', 'multiple', 'dayTrip'].includes(plan.accommodationMode)) return 'Choose an accommodation plan.';
  if (!validTravelDate(startDate) || !validTravelDate(endDate) || endDate < startDate) return 'Set valid trip dates before scheduling checks.';
  if (!Number.isInteger(plan.notificationMinutesBefore) || plan.notificationMinutesBefore < 0 || plan.notificationMinutesBefore > 10080) return 'Use a reminder offset between 0 and 10080 minutes.';
  if (plan.accommodationMode !== 'multiple') return validTravelDate(plan.returnDate) && plan.returnDate >= startDate && plan.returnDate <= endDate && validTime(plan.returnTime) ? '' : 'Choose a return date within the trip and a checkout time.';
  if (plan.stays.length < 2 || plan.stays.length > 20) return 'Add between 2 and 20 stay locations.';
  if (new Set(plan.stays.map(stay => stay.id)).size !== plan.stays.length || plan.stays.some(stay => !/^[A-Za-z0-9_-]{1,100}$/.test(stay.id))) return 'Each stay must have a unique ID.';
  let previous = '';
  for (const stay of plan.stays) {
    if (!stay.name.trim() || stay.name.trim().length > 200) return 'Enter a name for every stay.';
    if (!validTime(stay.checkOutTime)) return 'Enter a checkout time for every stay.';
    if (!validTravelDate(stay.checkOutDate) || stay.checkOutDate < startDate || stay.checkOutDate > endDate || (stay.checkInDate && (!validTravelDate(stay.checkInDate) || stay.checkInDate < startDate || stay.checkInDate > stay.checkOutDate || (previous && stay.checkInDate < previous.slice(0, 10))))) return 'Stay dates must be within the trip and must not overlap.';
    const checkout = `${stay.checkOutDate}T${stay.checkOutTime}`;
    if (previous && checkout <= previous) return 'Checkout dates and times must be in chronological order.';
    if (!Number.isInteger(stay.notificationMinutesBefore) || stay.notificationMinutesBefore < 0 || stay.notificationMinutesBefore > 10080) return 'Use a reminder offset between 0 and 10080 minutes.';
    previous = checkout;
  }
  return '';
}
function scheduled(date: string, time: string) { return validTravelDate(date) && validTime(time) ? new Date(`${date}T${time}:00`).toISOString() : ''; }
export function checkpointDefinitions(tripId: string, plan: TravelCheckPlan): TravelCheckpoint[] {
  const stays = plan.accommodationMode === 'multiple' && plan.stays.length >= 2 ? plan.stays : [];
  const make = (id: string, type: TravelCheckpoint['type'], fromLocation: string, toLocation: string, date: string, time: string, before: number): TravelCheckpoint => ({ id, tripId, type, fromLocation, toLocation, scheduledAt: scheduled(date, time), notificationMinutesBefore: before, status: 'upcoming', completedAt: '', snapshotAt: '', archived: false, items: [] });
  const transitions = stays.slice(0, -1).map((stay, index) => make(`move-${stay.id}`, 'transition', stay.name, stays[index + 1].name, stay.checkOutDate, stay.checkOutTime, stay.notificationMinutesBefore));
  const last = stays.at(-1);
  return [...transitions, make('return-home', 'returnHome', last?.name || '', '', last?.checkOutDate || plan.returnDate, last?.checkOutTime || plan.returnTime, last?.notificationMinutesBefore ?? plan.notificationMinutesBefore)];
}
export function reconcileCheckSchedules(existing: TravelCheckpoint[], definitions: TravelCheckpoint[]): TravelCheckpoint[] {
  const result = existing.map(check => {
    const next = definitions.find(value => value.id === check.id);
    if (check.snapshotAt || check.status !== 'upcoming') return check;
    return next ? { ...check, ...next, tripId: check.tripId } : { ...check, archived: true };
  });
  for (const definition of definitions) if (!result.some(check => check.id === definition.id)) result.push(definition);
  return result;
}
export function snapshotPackedAssignments(data: PackingData, now = new Date().toISOString()): TravelCheckItem[] {
  return data.assignments.flatMap(assignment => {
    const item = data.items.find(value => value.id === assignment.itemId);
    if (!item || assignment.status !== 'packed' || !isCurrentAssignment(item, assignment)) return [];
    const bag = data.bags.find(value => value.id === assignment.bagId);
    return [{ id: assignment.id, sourceItemId: item.id, sourceAssignmentId: assignment.id, itemName: item.name, itemNameKey: item.template && !item.customName ? item.template.nameKey : '', itemType: item.type, assigneeId: assignment.memberId, assigneeName: data.members.find(member => member.id === assignment.memberId)?.name || '', quantity: item.type === 'personal' ? item.template?.quantityPerPerson || 1 : 1, originalBagId: assignment.bagId || '', originalBagName: bag?.name || '', currentBagId: '', currentBagName: '', status: 'unchecked' as const, updatedAt: now }];
  });
}
export function checkItemResolved(item: TravelCheckItem) { return item.status === 'usedUp' || item.status === 'leaveBehind' || (item.status === 'packed' && !!item.currentBagId && !!item.currentBagName); }
export function checkProgress(check: Pick<TravelCheckpoint, 'items'>) {
  return { total: check.items.length, completed: check.items.filter(checkItemResolved).length, unchecked: check.items.filter(item => item.status === 'unchecked' || (item.status === 'packed' && !checkItemResolved(item))), missing: check.items.filter(item => item.status === 'missing'), unresolved: check.items.filter(item => !checkItemResolved(item)) };
}
export function canEditCheckItem(data: Pick<PackingData, 'ownerUid' | 'adminUids' | 'members'>, uid: string, item: TravelCheckItem) {
  return !!uid && (data.ownerUid === uid || data.adminUids.includes(uid) || data.members.some(member => member.id === item.assigneeId && member.uid === uid && member.active !== false));
}
export function nextTravelCheck(checks: TravelCheckpoint[]): TravelCheckpoint | undefined {
  const pending = checks.filter(check => !check.archived && check.status !== 'completed');
  return pending.filter(check => check.type === 'transition').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] || pending.find(check => check.type === 'returnHome');
}
export function travelReminderAt(check: TravelCheckpoint) { return check.scheduledAt ? new Date(new Date(check.scheduledAt).getTime() - check.notificationMinutesBefore * 60000).toISOString() : ''; }
export function storeTravelCheck(check: TravelCheckpoint): StoredTravelCheckpoint {
  const progress = checkProgress(check);
  return { ...check, items: Object.fromEntries(check.items.map(item => [item.id, item])), unresolvedCount: progress.unresolved.length, missingCount: progress.missing.length, lastUpdatedItemId: '' };
}
export function readTravelCheck(value: StoredTravelCheckpoint): TravelCheckpoint { return { ...value, items: Object.values(value.items || {}) }; }
