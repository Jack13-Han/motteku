'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { validateTravelPlan, type TravelCheckPlan } from '@/lib/travelChecks';
import AccommodationModeSelect from './AccommodationModeSelect';

export default function StayPlanEditor({ plan, startDate, endDate, disabled, onSave }: { plan: TravelCheckPlan; startDate: string; endDate: string; disabled: boolean; onSave: (value: TravelCheckPlan) => Promise<boolean> }) {
  const { t } = useLanguage();
  const [form, setForm] = useState(plan), [problem, setProblem] = useState(''), [saved, setSaved] = useState(false);
  const signature = JSON.stringify(plan);
  useEffect(() => { setForm(JSON.parse(signature)); }, [signature]);
  const update = (next: TravelCheckPlan) => { setForm(next); setSaved(false); setProblem(''); };
  function move(index: number, offset: number) { const stays = [...form.stays]; [stays[index], stays[index + offset]] = [stays[index + offset], stays[index]]; update({ ...form, stays }); }
  return <form className="travel-plan-editor" onSubmit={async event => {
    event.preventDefault(); const error = validateTravelPlan(form, startDate, endDate); setProblem(error);
    if (!error) setSaved(await onSave(form));
  }}><fieldset disabled={disabled}>
    <AccommodationModeSelect value={form.accommodationMode} onChange={accommodationMode => update({ ...form, accommodationMode })}/>
    {form.accommodationMode === 'multiple' ? <>
      <p>{t('Add stays in travel order. The final checkout is the return-home check.')}</p>
      {form.stays.map((stay, index) => <div className="travel-stay" key={stay.id}>
        <div className="travel-stay-heading"><strong>{t('Stay {number}', { number: index + 1 })}</strong><div className="travel-icon-actions">
          <button type="button" className="soft-button" aria-label={t('Move stay up')} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16}/></button>
          <button type="button" className="soft-button" aria-label={t('Move stay down')} disabled={index === form.stays.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16}/></button>
          <button type="button" className="soft-button" aria-label={t('Remove stay')} onClick={() => update({ ...form, stays: form.stays.filter(value => value.id !== stay.id) })}><Trash2 size={16}/></button>
        </div></div>
        <div className="travel-form-grid">
          <label>{t('Location name')}<input required maxLength={200} value={stay.name} onChange={event => update({ ...form, stays: form.stays.map(value => value.id === stay.id ? { ...value, name: event.target.value } : value) })}/></label>
          <label>{t('Check-in date (optional)')}<input type="date" min={startDate} max={stay.checkOutDate || endDate} value={stay.checkInDate || ''} onChange={event => update({ ...form, stays: form.stays.map(value => value.id === stay.id ? { ...value, checkInDate: event.target.value } : value) })}/></label>
          <label>{t('Checkout date')}<input required type="date" min={stay.checkInDate || startDate} max={endDate} value={stay.checkOutDate} onChange={event => update({ ...form, stays: form.stays.map(value => value.id === stay.id ? { ...value, checkOutDate: event.target.value } : value) })}/></label>
          <label>{t('Checkout time')}<input required type="time" value={stay.checkOutTime} onChange={event => update({ ...form, stays: form.stays.map(value => value.id === stay.id ? { ...value, checkOutTime: event.target.value } : value) })}/></label>
          <label>{t('Remind me minutes before')}<input type="number" required min={0} max={10080} value={stay.notificationMinutesBefore} onChange={event => update({ ...form, stays: form.stays.map(value => value.id === stay.id ? { ...value, notificationMinutesBefore: Number(event.target.value) } : value) })}/></label>
        </div>
      </div>)}
      <button type="button" className="soft-button" disabled={form.stays.length >= 20} onClick={() => update({ ...form, stays: [...form.stays, { id: crypto.randomUUID(), name: '', checkOutDate: '', checkOutTime: '10:00', notificationMinutesBefore: 60 }] })}><Plus size={16}/> {t('Add accommodation')}</button>
    </> : <div className="travel-form-grid">
      <label>{t('Return date')}<input required type="date" min={startDate} max={endDate} value={form.returnDate} onChange={event => update({ ...form, returnDate: event.target.value })}/></label>
      <label>{t('Checkout / return time')}<input required type="time" value={form.returnTime} onChange={event => update({ ...form, returnTime: event.target.value })}/></label>
      <label>{t('Remind me minutes before')}<input required type="number" min={0} max={10080} value={form.notificationMinutesBefore} onChange={event => update({ ...form, notificationMinutesBefore: Number(event.target.value) })}/></label>
    </div>}
    <p>{t('Reminders appear in the app while it is open. No background push notifications are sent.')}</p>
    <button type="submit" className="primary">{t('Save check schedule')}</button>
  </fieldset>{problem && <p role="alert" className="text-danger">{t(problem)}</p>}{saved && <p role="status">{t('Check schedule saved.')}</p>}</form>;
}
