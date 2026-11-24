'use client';
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import type { PackingData } from '@/lib/packing';
import { canEditCheckItem, checkpointTitle, checkProgress, nextTravelCheck } from '@/lib/travelChecks';
import type { TravelCheckController } from '@/lib/useTravelChecks';
import StayPlanEditor from './StayPlanEditor';
import TravelCheckItemCard from './TravelCheckItemCard';

export default function ForgottenItemCheck({ controller, packing, uid, startDate, endDate }: { controller: TravelCheckController; packing: PackingData | null; uid: string; startDate: string; endDate: string }) {
  const { t, date, language } = useLanguage();
  const available = controller.availableChecks || controller.checks;
  const next = nextTravelCheck(available);
  const [selected, setSelected] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const completeButton = useRef<HTMLButtonElement>(null);
  const active = available.filter(check => !check.archived);
  const check = active.find(value => value.id === selected) || next || active.find(value => value.type === 'returnHome');
  const progress = check ? checkProgress(check) : null;
  const transitions = active.filter(value => value.type === 'transition').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const names = (items: NonNullable<typeof check>['items']) => items.map(item => `${item.itemNameKey ? t(item.itemNameKey) : item.itemName} — ${item.assigneeName || t('Unassigned')}`).join(language === 'ja' ? '、' : ', ');
  useEffect(() => () => { dialog.current?.close(); }, []);
  return <section className="travel-check-page">
    <div className="panel"><div className="panel-head"><div><h3><ShieldCheck size={18}/> {t('Item check')}</h3><p>{t('Check the items packed for departure before moving or returning home.')}</p></div></div>
      <details open={controller.plan.accommodationMode === 'multiple' && controller.plan.stays.length < 2} className="travel-settings"><summary>{t('Accommodation and checkout settings')}</summary><StayPlanEditor plan={controller.plan} startDate={startDate} endDate={endDate} disabled={!controller.manager || controller.busy || !controller.readyForWrites} onSave={controller.savePlan}/></details>
      <p className="helper-note">{t('Changing a schedule never removes items from an active check.')}</p>
      {controller.error && <div className="notice" role="alert"><span>{t(controller.error)}</span><button className="soft-button" disabled={controller.busy} onClick={controller.retry}>{t('Retry')}</button></div>}
      {!controller.loaded && <p role="status">{t('Loading item checks…')}</p>}
      <div role="tablist" aria-label={t('Item check types')} className="travel-tabs">
        {transitions.length > 0 && <button role="tab" aria-selected={check?.type === 'transition'} onClick={() => setSelected(transitions.find(value => value.status !== 'completed')?.id || transitions[0].id)}>{t('Before-moving check')}</button>}
        <button role="tab" aria-selected={!check || check.type === 'returnHome'} onClick={() => setSelected('return-home')}>{t('Return-home check')}</button>
      </div>
      {check?.type === 'transition' && <label className="field-label">{t('Choose a moving check')}<select value={check.id} onChange={event => setSelected(event.target.value)}>{transitions.map(value => <option key={value.id} value={value.id}>{value.fromLocation} → {value.toLocation} · {date(value.scheduledAt, true)}{value.status === 'completed' ? ` · ${t('Completed')}` : ''}</option>)}</select></label>}
    </div>
    {check && progress && <div className="panel" role="tabpanel" aria-label={t(checkpointTitle(check))}>
      <h3>{t(checkpointTitle(check))}{next?.id === check.id && <span className="packing-type personal">{t('Next check')}</span>}</h3>
      {check.fromLocation && <p>{check.fromLocation} → {check.toLocation || t('Home')}</p>}
      <p>{check.scheduledAt ? date(check.scheduledAt, true) : t('Set a checkout time')}</p>
      {!check.snapshotAt ? <><p>{t('Starting creates a saved snapshot of departure-packed assignments.')}</p><button className="primary" disabled={!controller.manager || controller.busy || !controller.readyForWrites} onClick={() => { setSelected(check.id); void controller.start(check.id); }}>{t('Start check')}</button>{!controller.manager && <p>{t('Ask the owner or an admin to start this check.')}</p>}</> : <>
        <div className="travel-progress"><strong>{t('{completed} / {total} completed', { completed: progress.completed, total: progress.total })}</strong><progress aria-label={t('Check progress')} value={progress.completed} max={progress.total || 1}/></div>
        <div className="travel-group-progress">{[...new Set(check.items.map(item => item.assigneeId))].map(id => {
          const rows = check.items.filter(item => item.assigneeId === id), group = checkProgress({ items: rows });
          return <div key={id}><strong>{rows[0].assigneeName || t('Unassigned')}</strong><span>{t('{completed} / {total} completed', { completed: group.completed, total: group.total })}</span>{group.unresolved.length > 0 && <span>{t('Unresolved items: {count}', { count: group.unresolved.length })}</span>}</div>;
        })}</div>
        {check.status === 'completed' && <div className="travel-success" role="status"><strong>{t('All items have been checked.')}</strong><p>{t(check.type === 'returnHome' ? 'Travel home safely without leaving anything behind!' : 'Travel safely without leaving anything behind!')}</p></div>}
        <div className="travel-items">{check.items.map(item => <TravelCheckItemCard key={item.id} item={item} bags={packing?.bags || []} disabled={controller.busy || check.status === 'completed' || !packing || !canEditCheckItem(packing, uid, item)} onChange={(status, bagId) => controller.updateItem(check.id, item.id, status, bagId)}/>)}</div>
        {check.status !== 'completed' && <button ref={completeButton} className="primary" disabled={!controller.manager || controller.busy} onClick={() => { setSelected(check.id); if (progress.unresolved.length) dialog.current?.showModal(); else void controller.complete(check.id); }}>{t('Complete check')}</button>}
      </>}
    </div>}
    <dialog ref={dialog} className="travel-completion-dialog" aria-labelledby="travel-completion-title" onClose={() => completeButton.current?.focus()}>
      <h3 id="travel-completion-title">{t('The check cannot be completed yet.')}</h3>
      {!!progress?.unchecked.length && <><h4>{t('Still unchecked')}</h4><p>{names(progress.unchecked)}</p></>}
      {!!progress?.missing.length && <><h4 className="text-danger">{t('Missing items')}</h4><p className="text-danger">{names(progress.missing)}</p></>}
      <button className="primary" autoFocus onClick={() => dialog.current?.close()}>{t('Continue checking')}</button>
    </dialog>
  </section>;
}
