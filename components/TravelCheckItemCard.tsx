'use client';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import type { PackingBag } from '@/lib/packing';
import { checkStatusLabels, type TravelCheckItem, type TravelCheckItemStatus } from '@/lib/travelChecks';

export default function TravelCheckItemCard({ item, bags, disabled, onChange }: { item: TravelCheckItem; bags: PackingBag[]; disabled: boolean; onChange: (status: TravelCheckItemStatus, bagId: string) => Promise<boolean> }) {
  const { t } = useLanguage();
  const [choosingBag, setChoosingBag] = useState(false);
  const name = item.itemNameKey ? t(item.itemNameKey) : item.itemName;
  const needsBag = choosingBag || item.status === 'packed';
  return <article className={`travel-item travel-status-${item.status}`}>
    <div className="travel-item-heading"><h4>{name}</h4><span className={`packing-type ${item.itemType}`}>{t(item.itemType === 'personal' ? 'Personal' : 'Shared')}</span></div>
    <p>{t('Assigned to')}: <strong>{item.assigneeName || t('Unassigned')}</strong> · {t('Quantity: {count}', { count: item.quantity })}</p>
    <p>{t('Previous storage')}: {item.originalBagName || t('Bag not selected')}</p>
    <div className="travel-form-grid">
      <label>{t('Current status')}<select disabled={disabled} value={choosingBag ? 'packed' : item.status} onChange={async event => {
        const status = event.target.value as TravelCheckItemStatus;
        if (status === 'packed' && !bags.some(bag => bag.id === item.currentBagId)) { setChoosingBag(true); return; }
        setChoosingBag(false); await onChange(status, item.currentBagId);
      }}>{(Object.keys(checkStatusLabels) as TravelCheckItemStatus[]).map(status => <option key={status} value={status}>{t(checkStatusLabels[status])}</option>)}</select></label>
      {needsBag && <label>{t('Current bag / storage')}<select required disabled={disabled} aria-label={t('Current bag for {name}', { name })} value={item.currentBagId} onChange={async event => { if (event.target.value && await onChange('packed', event.target.value)) setChoosingBag(false); }}>
        <option value="">{t('Select bag')}</option>{bags.map(bag => <option key={bag.id} value={bag.id}>{bag.name}</option>)}{item.currentBagId && !bags.some(bag => bag.id === item.currentBagId) && <option value={item.currentBagId} disabled>{item.currentBagName} ({t('Deleted bag')})</option>}
      </select></label>}
    </div>
    {choosingBag && <p className="travel-warning" role="status">{t('Select a current bag before marking an item as packed.')}</p>}
    {item.status === 'missing' && <p className="text-danger">⚠️ {t('This item is missing. Resolve it before completing the check.')}</p>}
    {needsBag && !bags.length && <p>{t('Add a bag in Bags & photos before marking this item as packed.')}</p>}
  </article>;
}
