'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { errorKey } from '@/lib/messages';
import { tripTypeLabels, type TripInput } from '@/lib/trips';
import { updateTripDetails } from '@/lib/tripService';
import { Button } from './ui/button';

type Details = Pick<TripInput, 'type' | 'destination' | 'startDate' | 'endDate' | 'description'>;
export default function TripDetailsForm({ tripId, plannedMemberCount }: { tripId: string; plannedMemberCount: number }) {
  const { t } = useLanguage();
  const [details, setDetails] = useState<Details>({ type: 'camping', destination: '', startDate: '', endDate: '', description: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <section className="panel page-panel trip-details-step"><h2>{t('Choose your trip')}</h2><p>{t('A friend accepted your invitation. Now choose the destination, dates and trip type.')}</p>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await updateTripDetails(tripId, details); } catch (e) { setError(errorKey(e, 'Could not save the trip details. Check Firestore rules.')); } finally { setBusy(false); } }}>
      <fieldset disabled={busy} className="managed-form grid gap-4 md:grid-cols-2">
        <label>{t('Trip type')}<select value={details.type} onChange={e => setDetails({ ...details, type: e.target.value as Details['type'] })}>{Object.entries(tripTypeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label>{t('Destination')}<input required maxLength={200} value={details.destination} onChange={e => setDetails({ ...details, destination: e.target.value })}/></label>
        <label>{t('Start date')}<input required type="date" value={details.startDate} onChange={e => setDetails({ ...details, startDate: e.target.value })}/></label>
        <label>{t('End date')}<input required type="date" min={details.startDate} value={details.endDate} onChange={e => setDetails({ ...details, endDate: e.target.value })}/></label>
        <label className="md:col-span-2">{t('Description')}<textarea maxLength={2000} rows={3} value={details.description} onChange={e => setDetails({ ...details, description: e.target.value })}/></label>
        <Button type="submit" disabled={busy}>{t(busy ? 'Saving…' : 'Save trip details and continue')}</Button>
      </fieldset>
    </form>
    <p className="helper-note">{t('Planned: {count}', { count: plannedMemberCount })}</p>
    {error && <p role="alert" className="auth-error">{t(error)}</p>}
  </section>;
}
