'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { canEditAssignment, isCurrentAssignment, packingItemName, packingProgress, STATUS_LABELS, type PackingData, type ItemAssignment, type ItemStatus, type TripItem } from '@/lib/packing';

const statusEmoji: Record<ItemStatus, string> = { not_ready: '🕒', ready: '✅', packed: '🎒' };
const itemEmoji: Record<string, string> = { swimwear: '🩱', towel: '🧺', shoes: '🥾', water: '💧', medication: '💊', medicine: '💊', passport: '🛂', clothes: '👕', tent: '⛺', headlamp: '🔦', lantern: '🔦', food: '🍱', lunch: '🍱', charger: '🔋', umbrella: '☂️' };
function emojiFor(item: TripItem) {
  const source = item.template?.id || item.name.toLowerCase();
  return Object.entries(itemEmoji).find(([key]) => source.includes(key))?.[1] || '📦';
}

function PackingProgress({ ready, packed, total, personal }: { ready: number; packed: number; total: number; personal: boolean }) {
  const { t } = useLanguage();
  return <div className="packing-progress-grid">{([['Ready progress', ready], ['Packed progress', packed]] as const).map(([label, value]) => <div className="packing-progress" key={label}>
    <div><span>{t(label)}</span><strong>{t(personal ? '{count} of {total} members' : '{count} of {total} units', { count: value, total })}</strong></div>
    <progress aria-label={t(label)} max={total || 1} value={value} />
  </div>)}</div>;
}

export default function PackingCards({ data, uid, admin, disabled, onlyUnpacked, onFilter, onUpdate, onDelete }: {
  data: PackingData; uid: string; admin: boolean; disabled: boolean; onlyUnpacked: boolean;
  onFilter: (value: boolean) => void;
  onUpdate: (assignment: ItemAssignment, patch: Partial<Pick<ItemAssignment, 'status' | 'bagId' | 'memberId'>>) => void;
  onDelete: (item: TripItem) => Promise<boolean>;
}) {
  const { t, language } = useLanguage();
  const [deleting, setDeleting] = useState<TripItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (deleting) dialog.current?.showModal(); else dialog.current?.close(); }, [deleting]);
  const close = () => { setDeleting(null); trigger.current?.focus(); };
  const memberName = (id: string) => data.members.find(m => m.id === id)?.name || t('Unassigned');
  const visible = data.items.filter(item => !onlyUnpacked || !packingProgress(item, data.assignments).allPacked);
  const names = (ids: string[]) => ids.map(memberName).join(language === 'ja' ? '、' : ', ');
  return <>
    <div className="packing-filter"><label><input type="checkbox" checked={onlyUnpacked} onChange={e => onFilter(e.target.checked)} /><span>🎒 {t('Show unpacked items only')}</span></label><span role="status">{t('Showing {count} of {total} items', { count: visible.length, total: data.items.length })}</span></div>
    <div className="packing-card-sections">
      {(['personal', 'shared'] as const).map(type => {
        const sectionItems = data.items.filter(item => item.type === type);
        return <details className="packing-card-section" key={type} open>
          <summary><span><strong>{type === 'personal' ? '👤' : '👥'} {t(type === 'personal' ? 'Personal items' : 'Shared items')}</strong><small>{t(type === 'personal' ? 'Each member prepares their own items' : 'Items shared by the group')}</small></span><span className="packing-section-count">{t('{count} items · {complete} complete', { count: sectionItems.length, complete: sectionItems.filter(item => packingProgress(item, data.assignments).allPacked).length })}</span></summary>
          <div className="packing-cards">{visible.filter(item => item.type === type).map(item => {
            const progress = packingProgress(item, data.assignments);
            const allRows = data.assignments.filter(a => a.itemId === item.id).sort((a, b) => (a.unitNumber || 0) - (b.unitNumber || 0));
            const rows = allRows.filter(a => isCurrentAssignment(item, a));
            const retained = allRows.filter(a => !isCurrentAssignment(item, a));
            const name = packingItemName(item, t);
            return <article className="packing-card" key={item.id}>
              <header><h4><span aria-hidden="true">{emojiFor(item)}</span> {name}</h4><span className={`packing-type ${type}`}>{type === 'personal' ? '👤' : '👥'} {t(type === 'personal' ? 'Personal' : 'Shared')}</span>
                {admin && <button className="packing-delete" disabled={disabled} aria-label={t('Delete {name}', { name })} onClick={e => { trigger.current = e.currentTarget; setDeleting(item); }}>🗑️</button>}
              </header>
              <p className="packing-quantity">{item.template ? t('Required quantity: {count} {unit}', { count: item.quantity, unit: t(item.template.unitKey) }) : t('Required: {count}', { count: type === 'personal' ? item.targetMemberIds.length : item.quantity })}{type === 'personal' && <> · {t('Per member: {count} {unit}', { count: item.template?.quantityPerPerson || 1, unit: t(item.template?.unitKey || 'unit.items') })}</>}</p>
              <PackingProgress {...progress} personal={type === 'personal'} />
              <div className="packing-card-rows">{rows.map(a => {
                const editable = !disabled && canEditAssignment(data, uid, a);
                const bag = data.bags.find(b => b.id === a.bagId);
                const context = `${name} ${type === 'personal' ? memberName(a.memberId) : t('Unit {number}', { number: a.unitNumber || 1 })}`;
                return <div className={`packing-card-row ${type}`} key={a.id}>
                  <div className="packing-person"><span className="packing-avatar" aria-hidden="true">{type === 'personal' ? Array.from(memberName(a.memberId))[0] : a.unitNumber}</span><strong>{type === 'personal' ? memberName(a.memberId) : t('Unit {number}', { number: a.unitNumber || 1 })}</strong>{data.members.some(m => m.id === a.memberId && m.uid === uid) && <span className="packing-you">{t('You')}</span>}</div>
                  {type === 'shared' && <label>{t('Assignee')}<select aria-label={`${context} ${t('Assignee')}`} value={a.memberId} disabled={disabled || !admin} onChange={e => onUpdate(a, { memberId: e.target.value })}><option value="">{t('Unassigned')}</option>{!data.members.some(m => m.active !== false && m.id === a.memberId) && a.memberId && <option value={a.memberId} disabled>{memberName(a.memberId)} ({t('Former member')})</option>}{data.members.filter(m => m.active !== false).map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select>{!a.memberId && <small>⚠️ {t('Unassigned')}</small>}</label>}
                  <label>{t('Status')}<select className={`packing-status ${a.status}`} aria-label={`${context} ${t('Status')}`} disabled={!editable} value={a.status} onChange={e => onUpdate(a, { status: e.target.value as ItemStatus })}>{(Object.keys(STATUS_LABELS) as ItemStatus[]).map(status => <option value={status} key={status}>{statusEmoji[status]} {t(STATUS_LABELS[status])}</option>)}</select></label>
                  <label>{t('Bag')}<select aria-label={`${context} ${t('Bag')}`} value={a.bagId || ''} disabled={!editable} onChange={e => onUpdate(a, { bagId: e.target.value })}><option value="">🎒 {t('Select bag')}</option>{data.bags.map(b => <option value={b.id} key={b.id}>🎒 {b.name}</option>)}{a.bagId && !bag && <option value={a.bagId}>{t('Deleted bag')}</option>}</select><small>{bag ? <>🎒 {bag.name}</> : <>⚠️ {t(a.bagId ? 'Deleted bag' : 'Bag not selected')}</>}</small></label>
                </div>;
              })}</div>
              <div className="packing-alerts" aria-live="polite">
                <div className={progress.ready === progress.total && progress.total > 0 ? 'complete' : ''}>{progress.ready === progress.total && progress.total > 0 ? <>🎉 {t('Everyone is ready!')}</> : <>⚠️ {t(type === 'personal' ? '{count} members are not ready' : '{count} units are not ready', { count: progress.total - progress.ready })}{type === 'personal' && <small>{names(progress.notReadyMemberIds)}</small>}</>}</div>
                <div className={progress.allPacked ? 'complete' : ''}>{progress.allPacked ? <>✅ {t('Everyone has packed this item')}</> : <>🎒 {t(type === 'personal' ? '{count} members have not packed this item' : '{count} units have not been packed', { count: progress.total - progress.packed })}{type === 'personal' && <small>{names(progress.notPackedMemberIds)}</small>}</>}</div>
              </div>
              {retained.length > 0 && <details className="packing-history"><summary>{t('Retained history: {count}', { count: retained.length })}</summary>{retained.map(a => <p key={a.id}>{a.unitNumber ? t('Unit {number}', { number: a.unitNumber }) : memberName(a.memberId)} · {memberName(a.memberId)} · {t(STATUS_LABELS[a.status])} · {data.bags.find(b => b.id === a.bagId)?.name || t('Bag not selected')}</p>)}</details>}
            </article>;
          })}{!visible.some(item => item.type === type) && <p className="empty-inline">{t(sectionItems.length ? 'No unpacked items.' : 'No items yet.')}</p>}</div>
        </details>;
      })}
    </div>
    <dialog ref={dialog} className="packing-delete-dialog" aria-labelledby="packing-delete-title" aria-describedby="packing-delete-description" onCancel={e => { e.preventDefault(); if (!disabled) close(); }} onClose={() => { if (deleting) close(); }}>
      <h3 id="packing-delete-title">{t('Delete {name}?', { name: deleting ? packingItemName(deleting, t) : '' })}</h3><p id="packing-delete-description">{t('Member preparation statuses will also be deleted.')}</p><div className="bottom-actions"><button autoFocus className="soft-button" disabled={disabled} onClick={close}>{t('Cancel')}</button><button className="primary" disabled={disabled} onClick={() => { if (deleting) void onDelete(deleting).then(saved => { if (saved) close(); }); }}>{t('Delete item')}</button></div>
    </dialog>
  </>;
}
