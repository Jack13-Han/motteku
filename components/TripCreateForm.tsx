'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TripWorkflowFrame from './TripWorkflowFrame';
import { Button } from './ui/button';
import { useTripAccount } from '@/lib/useTrips';
import { useLanguage } from '@/lib/i18n';
import { errorKey } from '@/lib/messages';
import { createDraftTrip } from '@/lib/tripService';
import { tripTypeLabels, type TripInput } from '@/lib/trips';

export default function TripCreateForm() {
  const { t } = useLanguage(), { user } = useTripAccount(), router = useRouter();
  const [input, setInput] = useState<TripInput>({ name: '', type: 'camping', destination: '', startDate: '', endDate: '', plannedMemberCount: 5, description: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <TripWorkflowFrame title="Create a draft trip"><section className="panel page-panel">
    <p>{t('Create a draft first. Invite your group, then confirm members before generating the checklist.')}</p>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { router.push(`/trips/${await createDraftTrip(input, user)}`); } catch (e) { setError(errorKey(e, 'Could not save the trip. Check Firestore rules.')); setBusy(false); } }}>
      <fieldset disabled={busy} className="managed-form grid gap-4 md:grid-cols-2">
        <label>{t('Trip name')}<input required maxLength={200} value={input.name} onChange={e => setInput({ ...input, name: e.target.value })}/></label>
        <label>{t('Trip type')}<select value={input.type} onChange={e => setInput({ ...input, type: e.target.value as TripInput['type'] })}>{Object.entries(tripTypeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
        <label>{t('Destination')}<input required maxLength={200} value={input.destination} onChange={e => setInput({ ...input, destination: e.target.value })}/></label>
        <label>{t('Planned members')}<input type="number" min={1} max={100} step={1} required value={input.plannedMemberCount || ''} onChange={e => setInput({ ...input, plannedMemberCount: Number(e.target.value) })}/></label>
        <label>{t('Start date')}<input type="date" required value={input.startDate} onChange={e => setInput({ ...input, startDate: e.target.value })}/></label>
        <label>{t('End date')}<input type="date" required min={input.startDate} value={input.endDate} onChange={e => setInput({ ...input, endDate: e.target.value })}/></label>
        <label className="md:col-span-2">{t('Description')}<textarea maxLength={2000} rows={4} value={input.description} onChange={e => setInput({ ...input, description: e.target.value })}/></label>
        <Button type="submit">{t(busy ? 'Saving…' : 'Create draft')}</Button>
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
  </section></TripWorkflowFrame>;
}
