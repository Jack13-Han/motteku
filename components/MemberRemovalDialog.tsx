'use client';

import { useLanguage } from '@/lib/i18n';
import { packingItemName, type PackingData, type PackingMember } from '@/lib/packing';

export default function MemberRemovalDialog({ data, next, removed, legacyCount = 0, busy, onCancel, onConfirm }: {
  data: PackingData; next: PackingData; removed: PackingMember[]; legacyCount?: number; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const ids = removed.map(m => m.id);
  const affected = data.assignments.filter(a => ids.includes(a.memberId));
  const personal = affected.filter(a => data.items.find(i => i.id === a.itemId)?.type === 'personal');
  const shared = affected.filter(a => data.items.find(i => i.id === a.itemId)?.type === 'shared');
  return <div className="member-removal-backdrop"><section className="panel page-panel member-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="member-removal-title">
    <h3 id="member-removal-title">{t('Review member removal')}</h3>
    <p>{removed.map(m => m.name).join(', ')}</p>
    <p>{t('Checks and bags are retained in history. Shared assignments stay assigned until an admin reassigns them.')}</p>
    <ul>
      <li>{t('Personal checklists retained: {count}', { count: personal.length })}</li>
      <li>{t('Shared units needing reassignment: {count}', { count: shared.length })}</li>
      <li>{t('Legacy items becoming unassigned: {count}', { count: legacyCount })}</li>
    </ul>
    <ul>{data.items.map(item => {
      const updated = next.items.find(i => i.id === item.id);
      return updated && updated.quantity !== item.quantity ? <li key={item.id}>{packingItemName(item, t)}: {item.quantity} → {updated.quantity} {item.template ? t(item.template.unitKey) : ''}</li> : null;
    })}</ul>
    <p>{t('Surplus shared units are retained and reused if the group grows again.')}</p>
    <div className="bottom-actions">
      <button className="soft-button" disabled={busy} onClick={onCancel} autoFocus>{t('Cancel')}</button>
      <button className="primary" disabled={busy} onClick={onConfirm}>{t('Confirm removal and recalculate')}</button>
    </div>
  </section></div>;
}
