'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import type { ItemTemplate } from '@/lib/packing';

export type PackingDraftItem = { id: string; name: string; quantity: number; template?: ItemTemplate };

export default function PackingPreview({ items, setItems, onConfirm, onCancel }: {
  items: PackingDraftItem[];
  setItems: (items: PackingDraftItem[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const valid = items.length > 0 && items.every(item => (item.name.trim() || item.template) && Number.isSafeInteger(item.quantity) && item.quantity > 0 && (item.template || item.quantity <= 100));
  return <section className="advice-results" aria-label={t('Packing list preview')}>
    <h4>{t('Packing list preview')}</h4>
    <p>{t('Review, add or remove items and adjust quantities. Your trip is saved only after confirmation.')}</p>
    {(['personal', 'shared'] as const).map(type => <section key={type}>
      <h4>{t(type === 'personal' ? 'Personal' : 'Shared')}</h4>
      {items.filter(item => (item.template?.type || 'shared') === type).map(item => <div className="packing-preview-row" key={item.id}>
      <label>{t('Item')}<input maxLength={200} value={item.name || (item.template ? t(item.template.nameKey) : '')} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i))}/></label>
      <label>{t('Quantity')}<input type="number" min="1" max={item.template ? undefined : 100} step="1" readOnly={!!item.template} value={item.quantity || ''} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, quantity: Number(e.target.value) } : i))}/>{item.template && <small>{t(item.template.unitKey)} · {t('Calculated from registered members')}</small>}</label>
      <button type="button" className="soft-button" aria-label={`${t('Remove')} ${item.name}`} onClick={() => setItems(items.filter(i => i.id !== item.id))}>{t('Remove')}</button>
    </div>)}</section>)}
    <form className="bottom-actions" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; setItems([...items, { id: crypto.randomUUID(), name: name.trim(), quantity: 1 }]); setName(''); }}>
      <input aria-label={t('New item name')} placeholder={t('New item name')} value={name} onChange={e => setName(e.target.value)}/>
      <button className="soft-button" type="submit" disabled={!name.trim()}>{t('Add item')}</button>
    </form>
    <div className="bottom-actions">
      <button type="button" className="primary" disabled={!valid} onClick={onConfirm}>{t('Confirm and save trip')}</button>
      <button type="button" className="soft-button" onClick={onCancel}>{t('Back to trip details')}</button>
    </div>
  </section>;
}
