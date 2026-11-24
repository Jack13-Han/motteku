import { isCalendarDate } from './weather';

export { isCalendarDate as validReminderDate } from './weather';
export function reminderDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) return '';
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function tripReminders(startDate: string, prepStartDate?: string) {
  if (!isCalendarDate(startDate)) return [];
  const before = new Date(startDate + 'T00:00:00Z');
  before.setUTCDate(before.getUTCDate() - 1);
  const prep = isCalendarDate(prepStartDate || '') && prepStartDate! <= startDate ? prepStartDate! : startDate;
  return [
    { id: 'prep', date: prep, title: 'Preparation starts', detail: 'Review the plan and buy the remaining items.' },
    { id: 'before', date: before.toISOString().slice(0, 10), title: 'Day before departure', detail: 'Pack and verify the bags before departure.' },
    { id: 'departure', date: startDate, title: 'Trip departure', detail: 'Final check before leaving for this trip.' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function reminderNotificationKey(accountId: string, tripId: string, date: string, reminderId: string): string {
  return 'motteku-notified-' + JSON.stringify([accountId, tripId, date, reminderId]);
}
