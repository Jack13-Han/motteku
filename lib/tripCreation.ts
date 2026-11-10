export const customChecklistFallback = ['Water bottle', 'Phone charger', 'Clothes', 'Toiletries', 'Medication', 'First aid kit'];

export function localTripDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function tripCreationError(input: { type: string; destination: string; startDate: string; endDate: string; members: string[] }, today = localTripDate()): string {
  if (!input.type.trim() || input.type.trim().length > 60) return 'Choose or enter a trip type';
  if (!input.destination.trim() || input.destination.trim().length > 200 || !calendarDate(input.startDate) || !calendarDate(input.endDate) || !input.members.length || input.members.length > 100 || input.members.some(name => !name.trim() || name.trim().length > 200)) return 'Enter a destination, valid dates and 1–100 member names.';
  if (input.startDate < today) return 'Start date must be today or later.';
  if (input.endDate < input.startDate) return 'End date must be on or after the start date.';
  return '';
}

export function checklistNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [], seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    const key = name.normalize('NFKC').toLocaleLowerCase();
    if (!name || name.length > 200 || seen.has(key)) continue;
    seen.add(key); names.push(name);
    if (names.length === 20) break;
  }
  return names;
}

export function removeWorkspaceTrip<T extends { trips: { id: string }[]; activeTripId: string }>(workspace: T, tripId: string): T {
  const index = workspace.trips.findIndex(trip => trip.id === tripId);
  if (index < 0) return workspace;
  const trips = workspace.trips.filter(trip => trip.id !== tripId);
  const activeTripId = trips.some(trip => trip.id === workspace.activeTripId) ? workspace.activeTripId : trips[Math.min(index, trips.length - 1)]?.id || '';
  return { ...workspace, trips, activeTripId };
}
