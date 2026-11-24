'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { canEditAssignment, isCurrentAssignment, packingItemName, packingProgress, STATUS_LABELS, type PackingData, type ItemAssignment, type ItemStatus, type TripItem } from '@/lib/packing';

const itemEmoji: Record<string, string> = { clothes: '🧥', shoes: '👟', charger: '🔋', camera: '📷', toothbrush: '🪥', passport: '🛂', towel: '🧺', swimwear: '🩱', medicine: '💊', umbrella: '☂️', water: '💧', tent: '⛺' };
function emojiFor(item: TripItem) {
  const source = `${item.template?.id || ''} ${item.name}`.toLowerCase();
  return Object.entries(itemEmoji).find(([key]) => source.includes(key))?.[1] || '🎒';
}

export default function PackingCards({ data, uid, admin, disabled, onlyUnpacked, filterType, query, managedStage, onFilter, onUpdate, onDelete }: {
  data: PackingData; uid: string; admin: boolean; disabled: boolean; onlyUnpacked: boolean;
  filterType: 'all' | 'personal' | 'shared'; query: string; managedStage?: 'personal' | 'shared';
  onFilter: (value: boolean) => void;
  onUpdate: (assignment: ItemAssignment, patch: Partial<Pick<ItemAssignment, 'status' | 'bagId' | 'memberId'>>) => void;
  onDelete: (item: TripItem) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState<TripItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (deleting) dialog.current?.showModal(); else dialog.current?.close(); }, [deleting]);
  const close = () => { setDeleting(null); trigger.current?.focus(); };
  const visible = data.items.filter(item => {
    if (managedStage === 'personal' && item.type !== 'personal') return false;
    if (managedStage !== 'personal' && filterType !== 'all' && item.type !== filterType) return false;
    if (query.trim() && !packingItemName(item, t).toLowerCase().includes(query.trim().toLowerCase())) return false;
    const progress = packingProgress(item, data.assignments);
    return !onlyUnpacked || !progress.allPacked;
  });

  return <>
    <div className="packing-filter"><label><input type="checkbox" checked={onlyUnpacked} onChange={e => onFilter(e.target.checked)} /><span>{t('Unpacked Only')}</span></label><span role="status">{t('Showing {count} of {total} items', { count: visible.length, total: data.items.length })}</span></div>
    <div className="packing-list-rows">{visible.flatMap(item => {
      const assignments = data.assignments.filter(a => a.itemId === item.id && isCurrentAssignment(item, a)).sort((a,b)=>(a.unitNumber||0)-(b.unitNumber||0));
      const rows = assignments.length ? assignments : [null];
      return rows.map((assignment,index) => {
        const member = assignment ? data.members.find(m=>m.id===assignment.memberId)?.name || t('Unassigned') : t('Unassigned');
        const assignmentEditable = !!assignment && !disabled && canEditAssignment(data,uid,assignment);
        return <article className="packing-list-row" key={assignment?.id || `${item.id}-empty`}>
          <span className="packing-item-emoji" aria-hidden="true">{emojiFor(item)}</span>
          <div className="packing-item-title"><strong>{packingItemName(item,t)}</strong><span className={`packing-type ${item.type}`}>{t(item.type==='personal'?'Personal':'Shared')}</span></div>
          <span className="packing-category">{t(item.template?.category || 'Other')}</span>
          {item.type==='shared'&&assignment&&<label className="packing-assignee"><span>{t('Assignee')}</span><select aria-label={`${packingItemName(item,t)} ${t('Assignee')}`} value={assignment.memberId} disabled={disabled||!admin} onChange={e=>onUpdate(assignment,{memberId:e.target.value})}><option value="">{t('Unassigned')}</option>{data.members.filter(m=>m.active!==false).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
          <div className="packing-list-member"><span className="packing-list-avatar">{Array.from(member)[0]||'?'}</span><span>{item.type==='shared'&&assignment?t('Unit {number}',{number:assignment.unitNumber||index+1}):member}</span></div>
          {assignment?<select className={`packing-list-status ${assignment.status}`} aria-label={`${packingItemName(item,t)} ${member} ${t('Status')}`} value={assignment.status} disabled={!assignmentEditable} onChange={e=>onUpdate(assignment,{status:e.target.value as ItemStatus})}>{(Object.keys(STATUS_LABELS) as ItemStatus[]).map(status=><option key={status} value={status}>{t(STATUS_LABELS[status])}</option>)}</select>:<span className="packing-list-status not_ready">{t('Not ready')}</span>}
          {assignment&&<label className="packing-bag-select"><span>{t('Bag')}</span><select aria-label={`${packingItemName(item,t)} ${member} ${t('Bag')}`} value={assignment.bagId||''} disabled={!assignmentEditable} onChange={e=>onUpdate(assignment,{bagId:e.target.value})}><option value="">{t('Not selected')}</option>{data.bags.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          {admin&&<button ref={index===0?trigger:undefined} className="packing-delete" disabled={disabled} aria-label={t('Delete {name}',{name:packingItemName(item,t)})} onClick={()=>{trigger.current=document.activeElement as HTMLButtonElement;setDeleting(item);}}><MoreHorizontal size={19}/></button>}
        </article>;
      });
    })}{visible.length===0&&<p className="empty-inline">{t('No items yet.')}</p>}</div>
    <dialog ref={dialog} className="packing-delete-dialog" aria-labelledby="packing-delete-title" aria-describedby="packing-delete-description" onCancel={e=>{e.preventDefault();if(!disabled)close();}} onClose={()=>{if(deleting)close();}}>
      <h3 id="packing-delete-title">{t('Delete {name}?',{name:deleting?packingItemName(deleting,t):''})}</h3><p id="packing-delete-description">{t('Member preparation statuses will also be deleted.')}</p><div className="bottom-actions"><button autoFocus className="soft-button" disabled={disabled} onClick={close}>{t('Cancel')}</button><button className="primary" disabled={disabled} onClick={()=>{if(deleting)void onDelete(deleting).then(saved=>{if(saved)close();});}}><Trash2 size={15}/>{t('Delete item')}</button></div>
    </dialog>
  </>;
}
