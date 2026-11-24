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
  const [input, setInput] = useState<TripInput>({ name: '', type: 'camping', mode: 'group', destination: '', startDate: '', endDate: '', plannedMemberCount: 5, description: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <TripWorkflowFrame title="Create a draft trip"><section className="panel page-panel">
    <p>{t(input.mode === 'group' ? 'Create the group and invite friends first. Choose the destination and dates after a friend accepts.' : 'Choose a single trip and enter its details. You can start packing without invitations.')}</p>
    <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { router.push(`/trips/${await createDraftTrip(input, user)}`); } catch (e) { setError(errorKey(e, 'Could not save the trip. Check Firestore rules.')); setBusy(false); } }}>
      <fieldset disabled={busy} className="managed-form grid gap-4 md:grid-cols-2">
        <label>{t('Trip mode')}<select value={input.mode} onChange={e => { const mode = e.target.value as TripInput['mode']; setInput({ ...input, mode, destination: mode === 'group' ? '' : input.destination, startDate: mode === 'group' ? '' : input.startDate, endDate: mode === 'group' ? '' : input.endDate, description: mode === 'group' ? '' : input.description, plannedMemberCount: mode === 'single' ? 1 : Math.max(2, input.plannedMemberCount) }); }}><option value="single">{t('Single')}</option><option value="group">{t('Group')}</option></select></label>
        <label>{t('Trip name')}<input required maxLength={200} value={input.name} onChange={e => setInput({ ...input, name: e.target.value })}/></label>
        <label>{t('Planned members')}<input type="number" min={input.mode === 'single' ? 1 : 2} max={100} step={1} required disabled={input.mode === 'single'} value={input.plannedMemberCount || ''} onChange={e => setInput({ ...input, plannedMemberCount: Number(e.target.value) })}/></label>
        {input.mode === 'single' && <>
          <label>{t('Trip type')}<select value={input.type} onChange={e => setInput({ ...input, type: e.target.value as TripInput['type'] })}>{Object.entries(tripTypeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label>{t('Destination')}<input required maxLength={200} value={input.destination} onChange={e => setInput({ ...input, destination: e.target.value })}/></label>
          <label>{t('Start date')}<input type="date" required value={input.startDate} onChange={e => setInput({ ...input, startDate: e.target.value })}/></label>
          <label>{t('End date')}<input type="date" required min={input.startDate} value={input.endDate} onChange={e => setInput({ ...input, endDate: e.target.value })}/></label>
          <label className="md:col-span-2">{t('Description')}<textarea maxLength={2000} rows={4} value={input.description} onChange={e => setInput({ ...input, description: e.target.value })}/></label>
        </>}
        <Button type="submit">{t(busy ? 'Saving…' : input.mode === 'group' ? 'Create group and invite' : 'Create single trip')}</Button>
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
  </section></TripWorkflowFrame>;
}
