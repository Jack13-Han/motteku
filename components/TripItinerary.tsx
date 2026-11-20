'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, MapPin, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { activityCategories, activityError, normalizeActivities, removeActivity, upsertActivity, validItineraryDates, type ActivityDraft, type ActivityCategory, type TripActivity } from '@/lib/itinerary';

type Props = {
  trip: { id: string; startDate: string; endDate: string; activities?: TripActivity[] };
  onChange: (activities: TripActivity[]) => void;
};

export default function TripItinerary({ trip, onChange }: Props) {
  const { t: tr, date } = useLanguage();
  const empty = (): ActivityDraft => ({ title: '', date: trip.startDate, startTime: '09:00', endTime: '10:00', location: '', category: 'Sightseeing' });
  const [draft, setDraft] = useState<ActivityDraft>(empty);
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const activities = normalizeActivities(trip.activities);
  const dates = [...new Set(activities.map(activity => activity.date))];
  const validDates = validItineraryDates(trip.startDate, trip.endDate);

  useEffect(() => { setDraft(empty()); setEditingId(''); setError(''); setStatus(''); }, [trip.id]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = activityError(draft, trip.startDate, trip.endDate);
    if (problem) { setError(problem); setStatus(''); return; }
    try {
      const id = editingId || globalThis.crypto?.randomUUID?.() || 'activity-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      onChange(upsertActivity(activities, draft, id, trip.startDate, trip.endDate));
      setStatus(editingId ? 'Activity updated.' : 'Activity added.');
      setDraft(empty()); setEditingId(''); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check your input.'); }
  }

  function edit(activity: TripActivity) {
    const { id, ...fields } = activity;
    setEditingId(id); setDraft(fields); setError(''); setStatus('');
    nameInput.current?.focus();
  }

  function remove(id: string) {
    onChange(removeActivity(activities, id));
    if (id === editingId) { setDraft(empty()); setEditingId(''); setError(''); }
    setStatus('Activity removed.');
  }

  return <section className="panel itinerary-panel">
    <div className="itinerary-heading"><div><h2><CalendarDays size={22} /> {tr('Trip itinerary')}</h2><p>{tr('Plan each day of your trip.')}</p></div></div>
    <div className="itinerary-layout">
      <div className="itinerary-list">
        {!activities.length && <div className="itinerary-empty"><CalendarDays size={36} /><p>{tr(validDates ? 'No activities yet. Add your first stop.' : 'No activities yet.')}</p></div>}
        {dates.map(day => <section className="itinerary-day" key={day}>
          <h3>{validDates && <span>{tr('Day {number}', { number: Math.floor((Date.parse(day + 'T00:00:00Z') - Date.parse(trip.startDate + 'T00:00:00Z')) / 86400000) + 1 })}</span>}<small>{date(day)}</small></h3>
          {activities.filter(activity => activity.date === day).map(activity => <article className="itinerary-activity" key={activity.id}>
            <span className="itinerary-activity-icon"><MapPin size={21} /></span>
            <div className="itinerary-activity-main"><h4>{activity.title}</h4><div className="itinerary-activity-meta"><span><Clock3 size={14} /> {activity.startTime} – {activity.endTime}</span><span><MapPin size={14} /> {activity.location || tr('Location not set')}</span></div><span className="itinerary-category">{tr(activity.category)}</span></div>
            <div className="itinerary-activity-actions"><button type="button" disabled={!validDates} onClick={() => edit(activity)} aria-label={tr('Edit {name}', { name: activity.title })} title={tr('Edit {name}', { name: activity.title })}><Pencil size={16} /></button><button type="button" onClick={() => remove(activity.id)} aria-label={tr('Delete {name}', { name: activity.title })} title={tr('Delete {name}', { name: activity.title })}><Trash2 size={16} /></button></div>
          </article>)}
        </section>)}
      </div>
      {validDates ? <form className="itinerary-form" onSubmit={submit}>
        <h3>{tr(editingId ? 'Edit activity' : 'Add activity')}</h3>
        <label className="field">{tr('Activity name')}<input ref={nameInput} required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="itinerary-form-grid"><label className="field">{tr('Activity date')}<input type="date" required min={trip.startDate} max={trip.endDate} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label><label className="field">{tr('Activity category')}<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as ActivityCategory })}>{activityCategories.map(category => <option key={category} value={category}>{tr(category)}</option>)}</select></label><label className="field">{tr('Start time')}<input type="time" required value={draft.startTime} onChange={event => setDraft({ ...draft, startTime: event.target.value })} /></label><label className="field">{tr('End time')}<input type="time" required value={draft.endTime} onChange={event => setDraft({ ...draft, endTime: event.target.value })} /></label></div>
        <label className="field">{tr('Activity location')}<input maxLength={160} value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
        {error && <p className="notice" role="alert">{tr(error)}</p>}
        {status && <p role="status">{tr(status)}</p>}
        <div className="itinerary-form-actions"><button className="primary" type="submit">{editingId ? <Save size={17} /> : <Plus size={17} />}{tr(editingId ? 'Save activity' : 'Add activity')}</button>{editingId && <button type="button" onClick={() => { setDraft(empty()); setEditingId(''); setError(''); setStatus(''); }}>{tr('Cancel editing')}</button>}</div>
        <p className="muted">{tr('Itinerary is saved in your workspace.')}</p>
      </form> : <div className="itinerary-form"><p role="status">{tr('Create a trip with valid travel dates to plan activities.')}</p>{status && <p role="status">{tr(status)}</p>}</div>}
    </div>
  </section>;
}
