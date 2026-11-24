export const activityCategories = ['Sightseeing', 'Food', 'Shopping', 'Travel', 'Other'] as const;
export type ActivityCategory = typeof activityCategories[number];

export type TripActivity = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  category: ActivityCategory;
};
export type ActivityDraft = Omit<TripActivity, 'id'>;

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validItineraryDates(startDate: string, endDate: string): boolean {
  return calendarDate(startDate) && calendarDate(endDate) && startDate <= endDate;
}

export function activityError(draft: ActivityDraft, startDate: string, endDate: string): string {
  if (!draft.title.trim() || draft.title.trim().length > 120) return 'Enter an activity name using 1–120 characters.';
  if (!calendarDate(draft.date) || !validItineraryDates(startDate, endDate) || draft.date < startDate || draft.date > endDate) return 'Choose a date within this trip.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime) || draft.endTime <= draft.startTime) return 'Choose an end time after the start time.';
  if (draft.location.trim().length > 160) return 'Keep the activity location within 160 characters.';
  if (!activityCategories.includes(draft.category)) return 'Choose an activity category.';
  return '';
}

export function sortedActivities(activities: readonly TripActivity[] = []): TripActivity[] {
  return [...activities].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime) || a.id.localeCompare(b.id));
}

export function normalizeActivities(input: unknown): TripActivity[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return sortedActivities(input.filter((entry): entry is TripActivity => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) return false;
    if (!['title', 'date', 'startTime', 'endTime', 'location', 'category'].every(key => typeof entry[key] === 'string')) return false;
    if (activityError(entry, entry.date, entry.date)) return false;
    seen.add(entry.id);
    return true;
  }).map(entry => ({ id: entry.id, title: entry.title, date: entry.date, startTime: entry.startTime, endTime: entry.endTime, location: entry.location, category: entry.category })));
}

export function upsertActivity(activities: readonly TripActivity[], draft: ActivityDraft, id: string, startDate: string, endDate: string): TripActivity[] {
  const error = activityError(draft, startDate, endDate);
  if (error) throw new Error(error);
  if (!id) throw new Error('Check your input.');
  if (activities.length >= 500 && !activities.some(activity => activity.id === id)) throw new Error('This trip already has 500 activities.');
  const next: TripActivity = { ...draft, title: draft.title.trim(), location: draft.location.trim(), id };
  return sortedActivities([...activities.filter(activity => activity.id !== id), next]);
}

export function removeActivity(activities: readonly TripActivity[], id: string): TripActivity[] {
  return activities.filter(activity => activity.id !== id);
}
