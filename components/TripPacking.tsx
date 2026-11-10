'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { errorKey } from '@/lib/messages';
import { collection, doc, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, firebaseConfigured } from '@/lib/firebase';
import type { usePacking } from '@/lib/usePacking';
import { packingTemplates } from '@/lib/packingTemplates';
import PackingCards from './PackingCards';
import MemberRemovalDialog from './MemberRemovalDialog';
import { canEditAssignment, createPackingItem, reconcilePacking, STATUS_LABELS, type ItemAssignment, type ItemStatus, type PackingBag, type Registration, type TripItem } from '@/lib/packing';

type Props = {
  managed?: boolean;
  readOnly?: boolean;
  tripId: string;
  tripType: string;
  packing: ReturnType<typeof usePacking>;
  roomId?: string;
  userUid?: string;
  members: { id: string; name: string }[];
  bags: PackingBag[];
  legacyItems: { id: string; name: string; quantity?: number; assignee: string; status: string; bagId?: string }[];
};
const emptyUnit = () => ({ memberId: '', status: 'not_ready' as ItemStatus, bagId: '' });
const initialForm = (): Registration => ({ name: '', type: 'personal', targetMemberIds: [], units: [emptyUnit()], status: 'not_ready', bagId: '' });

export default function TripPacking({ tripId, tripType, packing, managed = false, readOnly = false, roomId = '', userUid, members, bags, legacyItems }: Props) {
  const { t } = useLanguage();
  const uid = userUid || (firebaseConfigured ? '' : 'local-owner');
  const scope = managed ? tripId : roomId || `${uid}_${tripId}`;
  const { data, error, setError, busy, loaded, roomMembers, cloud, mutate, commitPlan } = packing;
  const [reviewRoster, setReviewRoster] = useState(false);
  const [form, setForm] = useState<Registration>(initialForm);
  const [all, setAll] = useState(true);
  const [onlyNotReady, setOnlyNotReady] = useState(false);
  const admin = !!data && (data.ownerUid === uid || data.adminUids.includes(uid));
  const disabled = busy || !loaded || readOnly;
  const roster = data?.members.filter(m => m.active !== false) || [];
  const packingBags = data?.bags || [];
  const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>);
  const memberOptions = roster.map(m => <option key={m.id} value={m.id}>{m.name}</option>);
  const bagOptions = <><option value="">{t("Not selected")}</option>{packingBags.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</>;

  function register(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !admin) return;
    try {
      const result = createPackingItem(scope, uid, { ...form, targetMemberIds: all ? roster.map(m => m.id) : form.targetMemberIds }, roster, packingBags, crypto.randomUUID());
      void mutate(current => ({ ...current, items: [...current.items, result.item], assignments: [...current.assignments, ...result.assignments] }), (batch, parent) => {
        batch.set(doc(parent, 'items', result.item.id), { ...result.item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        result.assignments.forEach(a => batch.set(doc(parent, 'itemAssignments', a.id), { ...a, updatedAt: serverTimestamp() }));
      }).then(saved => { if (saved) { setForm(initialForm()); setAll(true); } });
    } catch (e) { setError(errorKey(e, "Check your input.")); }
  }

  function updateAssignment(assignment: ItemAssignment, patch: Partial<Pick<ItemAssignment, 'status' | 'bagId' | 'memberId'>>) {
    if (!data || !canEditAssignment(data, uid, assignment)) return;
    if ('memberId' in patch && !admin) return;
    void mutate(current => ({ ...current, assignments: current.assignments.map(a => a.id === assignment.id ? { ...a, ...patch, updatedAt: Timestamp.now() } : a) }), (batch, parent) => {
      batch.update(doc(parent, 'itemAssignments', assignment.id), { ...patch, updatedAt: serverTimestamp() });
    });
  }

  function syncRoster() {
    if (!data || !admin) return;
    if (!members.length) { setError('Use between 1 and 100 members.'); return; }
    try {
      if (roster.some(m => !members.some(next => next.id === m.id))) { setReviewRoster(true); return; }
      void commitPlan({ ...reconcilePacking(data, members, scope, uid), bags });
    } catch (e) { setError(errorKey(e, 'Check your input.')); }
  }

  function generateTemplates() {
    if (!data || !admin) return;
    try {
      void commitPlan(reconcilePacking(data, roster, scope, uid, (packingTemplates[tripType] || []).map(template => ({ template }))));
    } catch (e) { setError(errorKey(e, 'Check your input.')); }
  }

  function importLegacy() {
    if (!data || !admin) return;
    const existing = new Set(data.items.map(i => i.id));
    const pending = legacyItems.filter(i => !existing.has(`legacy-${i.id}`)).slice(0, 3);
    try {
      const results = pending.map(old => {
        const memberId = roster.find(m => m.name === old.assignee)?.id;
        if (!memberId) throw new Error("Assign this item in the legacy checklist first.");
        const quantity = old.quantity || 1;
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Required quantity must be between 1 and 100.");
        return createPackingItem(scope, uid, { name: old.name, type: 'shared', targetMemberIds: [], units: Array.from({ length: quantity }, () => ({ memberId, status: old.status === 'Packed' ? 'packed' : old.status === 'Owned' || old.status === 'Purchased' ? 'ready' : 'not_ready', bagId: packingBags.some(b => b.id === old.bagId) ? old.bagId! : '' })), status: 'not_ready', bagId: '' }, roster, packingBags, `legacy-${old.id}`);
      });
      void mutate(current => ({ ...current, items: [...current.items, ...results.map(r => r.item)], assignments: [...current.assignments, ...results.flatMap(r => r.assignments)] }), (batch, parent) => {
        results.forEach(r => {
          batch.set(doc(parent, 'items', r.item.id), { ...r.item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          r.assignments.forEach(a => batch.set(doc(parent, 'itemAssignments', a.id), { ...a, updatedAt: serverTimestamp() }));
        });
      });
    } catch (e) { setError(errorKey(e, "Could not import items.")); }
  }

  async function copyPrivateToShared() {
    if (!db || !roomId || !data || data.ownerUid !== uid) return;
    try {
      const privateParent = doc(db, 'packingTrips', `${uid}_${tripId}`);
      const [oldItems, oldAssignments, oldMembers] = await Promise.all([
        getDocs(collection(privateParent, 'items')), getDocs(collection(privateParent, 'itemAssignments')), getDocs(collection(privateParent, 'members')),
      ]);
      const pending = oldItems.docs.map(d => d.data() as TripItem).filter(i => !data.items.some(current => current.id === i.id)).slice(0, 3);
      const assignments = oldAssignments.docs.map(d => d.data() as ItemAssignment).filter(a => pending.some(i => i.id === a.itemId)).map(a => ({ ...a, tripId: scope, bagId: packingBags.some(b => b.id === a.bagId) ? a.bagId : '', updatedAt: Timestamp.now() }));
      const importedMembers = oldMembers.docs.map(d => d.data() as { id: string; name: string; uid: string }).filter(m => !roster.some(current => current.id === m.id)).map(m => ({ ...m, uid: m.uid === uid ? uid : '' }));
      const items = pending.map(i => ({ ...i, tripId: scope, createdBy: uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
      if (!items.length) { setError("No private items left to copy."); return; }
      await mutate(current => ({ ...current, members: [...current.members, ...importedMembers], items: [...current.items, ...items], assignments: [...current.assignments, ...assignments] }), (batch, parent) => {
        importedMembers.forEach(m => batch.set(doc(parent, 'members', m.id), m));
        items.forEach(i => batch.set(doc(parent, 'items', i.id), { ...i, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        assignments.forEach(a => batch.set(doc(parent, 'itemAssignments', a.id), { ...a, updatedAt: serverTimestamp() }));
      });
    } catch { setError("Could not read private items. Create the private checklist and check Firestore permissions."); }
  }

  return <section className="panel page-panel packing-v2">
    <div className="panel-head"><div><h3>{t("Personal and shared items")}</h3><p>{t(cloud ? "Saved and synced with Firestore." : "Local demo: saved in this browser.")} {t("Ready and packed counts are shown separately.")}</p></div></div>
    {error && <p className="notice" role="alert">{t(error)}</p>}
    {!loaded && !error && <p role="status">{t("Loading packing items…")}</p>}
    {busy && <p role="status">{t("Saving…")}</p>}
    {data && loaded && <>
      {!managed && <details className="packing-settings"><summary>{t("Members, bags and permissions")}</summary>
        <p>{t("Signed-in UID")}: <code>{uid}</code>. {t("You can update your own status. Owners and admins can manage everyone.")}</p>
        {admin && <>
          <button className="soft-button" disabled={disabled} onClick={syncRoster}>{t("Refresh trip members and bags")}</button>
          {cloud && roomId && data.ownerUid === uid && <button className="soft-button" disabled={disabled} onClick={copyPrivateToShared}>{t("Copy private items (3 at a time)")}</button>}
          <p>{t('Generated quantities follow registered members. Link accounts below for shared editing.')}</p>
          {roster.map(m => <label className="packing-binding" key={m.id}>{m.name}
            <select aria-label={t("Account for {name}", { name: m.name })} value={m.uid} disabled={disabled} onChange={e => {
              const next = { ...m, uid: e.target.value };
              void mutate(current => ({ ...current, members: current.members.map(old => old.id === m.id ? next : old) }), (batch, parent) => batch.set(doc(parent, 'members', m.id), next));
            }}>
              <option value="">{t("Not linked (admins only)")}</option>
              <option value={data.ownerUid}>{t("Trip owner")}</option>
              {roomMembers.filter(u => u.uid !== data.ownerUid).map(u => <option key={u.uid} value={u.uid}>{u.name} ({u.uid})</option>)}
            </select>
          </label>)}
          {uid === data.ownerUid && roomMembers.filter(m => m.uid !== uid).map(m => <label className="packing-check" key={m.uid}><input type="checkbox" checked={data.adminUids.includes(m.uid)} disabled={disabled} onChange={e => {
            const adminUids = e.target.checked ? [...data.adminUids, m.uid] : data.adminUids.filter(id => id !== m.uid);
            void mutate(current => ({ ...current, adminUids }), (batch, parent) => batch.update(parent, { adminUids }));
          }}/>{t("Make {name} an admin", { name: m.name })}</label>)}
        </>}
      </details>}
      {reviewRoster && members.length > 0 && <MemberRemovalDialog data={data} next={reconcilePacking(data, members, scope, uid)} removed={roster.filter(m => !members.some(next => next.id === m.id))} busy={busy} onCancel={() => setReviewRoster(false)} onConfirm={() => {
        void commitPlan({ ...reconcilePacking(data, members, scope, uid), bags }).then(saved => { if (saved) setReviewRoster(false); });
      }}/>}
      {admin && !managed && <div className="packing-registration"><h4>{t('Generate from template')}</h4><p>{t('Members: {count}', { count: roster.length })} · {t(tripType)}</p><button className="primary" disabled={disabled || !roster.length} onClick={generateTemplates}>{t('Generate or recalculate')}</button><p>{t('Existing checks, assignees and bags are preserved.')}</p></div>}
      {admin && <form className="packing-registration" onSubmit={register}>
        <h4>{t("Item registration")}</h4>
        <fieldset disabled={disabled}>
          <div className="packing-form-grid">
            <label>{t("Item name")}<input required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
            <label>{t("Type")}<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Registration['type'] })}><option value="personal">{t("Personal")}</option><option value="shared">{t("Shared")}</option></select></label>
          </div>
          {form.type === 'personal' ? <>
            <h4>{t("Target members")}</h4>
            <label className="packing-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/>{t("Everyone")}</label>
            {!all && roster.map(m => <label className="packing-check" key={m.id}><input type="checkbox" checked={form.targetMemberIds.includes(m.id)} onChange={e => setForm({ ...form, targetMemberIds: e.target.checked ? [...form.targetMemberIds, m.id] : form.targetMemberIds.filter(id => id !== m.id) })}/>{m.name}</label>)}
            <p>{t("Members: {count}", { count: all ? roster.length : form.targetMemberIds.length })}</p>
            <div className="packing-form-grid"><label>{t("Initial status")}<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as ItemStatus })}>{statusOptions}</select></label><label>{t("Bag (each member can change it later)")}<select value={form.bagId} onChange={e => setForm({ ...form, bagId: e.target.value })}>{bagOptions}</select></label></div>
          </> : <>
            <label>{t("Required")}<input type="number" min="1" max="100" step="1" required value={form.units.length} onChange={e => {
              const count = Number(e.target.value);
              if (Number.isInteger(count) && count >= 1 && count <= 100) setForm({ ...form, units: Array.from({ length: count }, (_, i) => form.units[i] || emptyUnit()) });
            }}/></label>
            {form.units.map((unit, index) => <div className="packing-form-grid packing-unit" key={index}>
              <b>{t("Unit {number}", { number: index + 1 })}</b>
              <label>{t("Assignee")}<select required value={unit.memberId} onChange={e => setForm({ ...form, units: form.units.map((u, i) => i === index ? { ...u, memberId: e.target.value } : u) })}><option value="">{t("Select an option")}</option>{memberOptions}</select></label>
              <label>{t("Status")}<select value={unit.status} onChange={e => setForm({ ...form, units: form.units.map((u, i) => i === index ? { ...u, status: e.target.value as ItemStatus } : u) })}>{statusOptions}</select></label>
              <label>{t("Bag")}<select value={unit.bagId} onChange={e => setForm({ ...form, units: form.units.map((u, i) => i === index ? { ...u, bagId: e.target.value } : u) })}>{bagOptions}</select></label>
            </div>)}
          </>}
          <div className="bottom-actions"><button className="primary" type="submit" disabled={!roster.length}>{t("Add item")}</button><button className="soft-button" type="button" onClick={() => { setForm(initialForm()); setAll(true); }}>{t("Clear input")}</button></div>
        </fieldset>
      </form>}
      <PackingCards data={data} uid={uid} admin={admin} disabled={disabled} onlyUnpacked={onlyNotReady} onFilter={setOnlyNotReady} onUpdate={updateAssignment} onDelete={item => {
        const allRows = data.assignments.filter(a => a.itemId === item.id);
        return mutate(current => ({ ...current, items: current.items.filter(i => i.id !== item.id), assignments: current.assignments.filter(a => a.itemId !== item.id) }), (batch, parent) => {
          batch.delete(doc(parent, 'items', item.id));
          allRows.forEach(a => batch.delete(doc(parent, 'itemAssignments', a.id)));
        });
      }}/>
      {admin && legacyItems.length > 0 && <details className="packing-settings"><summary>{t("Import legacy checklist")}</summary><p>{t("Copies up to 3 assigned legacy items as shared items without changing the original list. Register personal items above. Previously imported items are skipped.")}</p><button className="soft-button" disabled={disabled || legacyItems.every(i => data.items.some(item => item.id === `legacy-${i.id}`))} onClick={importLegacy}>{t("Copy next 3 items")}</button></details>}
    </>}
  </section>;
}
