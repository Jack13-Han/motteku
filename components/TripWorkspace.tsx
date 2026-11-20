'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { errorKey } from '@/lib/messages';
import { useManagedTrip, useTripAccount } from '@/lib/useTrips';
import { usePacking } from '@/lib/usePacking';
import { packingItemName, reconcilePacking } from '@/lib/packing';
import { packingTemplates } from '@/lib/packingTemplates';
import { templateTripTypes } from '@/lib/trips';
import { completeTrip, confirmMembers, disableInvitation, issueInvitation, markPackingReady, setMemberRole } from '@/lib/tripService';
import TripWorkflowFrame from './TripWorkflowFrame';
import TripPacking from './TripPacking';
import WeatherAdvice from './WeatherAdvice';
import { addAdviceItem } from '@/lib/addAdviceItem';
import { Button } from './ui/button';

const statusLabels = { draft: 'Draft', recruiting: 'Recruiting', confirmed: 'Confirmed', completed: 'Completed' };
const roleLabels = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function TripWorkspace({ tripId }: { tripId: string }) {
  const { user } = useTripAccount(), { t, date } = useLanguage();
  const state = useManagedTrip(tripId, user?.uid || '');
  const { trip, members, invitation, loaded } = state;
  const confirmed = members.filter(member => trip?.confirmedMemberIds.includes(member.uid));
  const packing = usePacking(loaded ? tripId : '', tripId, '', user?.uid || '', confirmed, []);
  const [busy, setBusy] = useState(false), [review, setReview] = useState(false), [notice, setNotice] = useState(''), [bagName, setBagName] = useState('');
  const role = members.find(member => member.uid === user?.uid)?.role;
  const manager = role === 'owner' || role === 'admin';
  const locked = busy || packing.busy;
  const changed = !!trip && (members.length !== trip.confirmedMemberIds.length || members.some(member => !trip.confirmedMemberIds.includes(member.uid)));
  const templates = trip ? (packingTemplates[templateTripTypes[trip.type]] || []).map(template => ({ template })) : [];
  const buildPlan = () => packing.data && members.length ? reconcilePacking(packing.data, members.map(member => ({ id: member.uid, uid: member.uid, name: member.name })), tripId, user?.uid || '', templates) : null;
  const next = review ? buildPlan() : null;
  const controller = { ...packing, data: packing.data ? { ...packing.data, adminUids: members.filter(member => member.role === 'admin').map(member => member.uid) } : null };
  async function act(action: () => Promise<unknown>) {
    if (locked) return;
    setBusy(true); state.setError(''); setNotice('');
    try { await action(); } catch (e) { state.setError(errorKey(e, 'Could not update the trip. Check your permissions and try again.')); }
    finally { setBusy(false); }
  }
  async function copy(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setNotice(message); } catch { state.setError('Could not copy. Select the invitation text and copy it.'); }
  }
  return <TripWorkflowFrame title="Trip workspace">
    {state.error && <p className="notice" role="alert">{t(state.error)}</p>}
    {!loaded && !state.error && <p role="status">{t('Loading')}</p>}
    {trip && loaded && <>
      <section className="panel page-panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2>{trip.name}</h2><p>{trip.destination} · {date(trip.startDate)} → {date(trip.endDate)}</p></div><span className="packing-badge">{t(statusLabels[trip.status])}</span></div><p className="whitespace-pre-wrap">{trip.description}</p>
        <div className="managed-counts"><strong>{t('Planned: {count}', { count: trip.plannedMemberCount })}</strong><strong>{t('Joined: {count}', { count: members.length })}</strong><span>{t('Remaining: {count}', { count: Math.max(0, trip.plannedMemberCount - members.length) })}</span></div>
        {locked && <p role="status">{t('Saving…')}</p>}
        {notice && <p role="status">{t(notice)}</p>}
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="panel page-panel"><h2>{t('Invite members')}</h2>
          {manager && trip.status !== 'completed' ? <>
            <p>{t('Invitations expire after seven days. Reissuing invalidates the previous invitation.')}</p>
            {invitation && <><label className="field-label">{t('Invitation link')}<input readOnly value={typeof window === 'undefined' ? '' : `${window.location.origin}/join/${invitation.id}`} onFocus={e => e.currentTarget.select()}/></label><label className="field-label">{t('Invitation code')}<input readOnly value={invitation.code} onFocus={e => e.currentTarget.select()}/></label><p>{t('Expires')}: {date(invitation.expiresAt.toDate(), true)}</p><p>{t('Uses: {used} / {max}', { used: invitation.usedCount, max: invitation.maxUses || 99 })}</p>
              <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copy(`${window.location.origin}/join/${invitation.id}`, 'Invite link copied.')}>{t('Copy invite link')}</Button><Button variant="outline" onClick={() => void copy(invitation.code, 'Invitation code copied.')}>{t('Copy invitation code')}</Button></div></>}
            <div className="mt-4 flex flex-wrap gap-2"><Button disabled={locked} onClick={() => void act(() => issueInvitation(tripId, user))}>{t(trip.activeInviteId ? 'Reissue invitation' : 'Create invitation')}</Button>{trip.activeInviteId && <Button variant="outline" disabled={locked} onClick={() => void act(() => disableInvitation(tripId))}>{t('Disable invitation')}</Button>}</div>
          </> : <p>{t(trip.status === 'completed' ? 'This trip is completed.' : 'Ask the owner or an admin for an invitation.')}</p>}
        </section>
        <section className="panel page-panel"><h2>{t('Trip members')}</h2>
          <ul className="managed-members">{members.map(member => <li key={member.uid}><span>{member.name}</span>{role === 'owner' && member.role !== 'owner' && trip.status !== 'completed' ? <select aria-label={t('Role for {name}', { name: member.name })} value={member.role} disabled={locked} onChange={e => void act(() => setMemberRole(tripId, member.uid, e.target.value as 'admin' | 'member'))}><option value="member">{t('Member')}</option><option value="admin">{t('Admin')}</option></select> : <span>{t(roleLabels[member.role])}</span>}</li>)}</ul>
          {trip.status !== 'confirmed' && trip.status !== 'completed' && (role === 'owner' ? <Button disabled={locked || !packing.loaded} onClick={() => setReview(true)}>{t('Confirm members')}</Button> : <p>{t('Waiting for the owner to confirm the members.')}</p>)}
          {trip.status === 'confirmed' && changed && <div className="managed-callout"><p>{t('Membership changed from {before} to {after}. Recalculate the checklist?', { before: trip.confirmedMemberIds.length, after: members.length })}</p>{manager ? <Button disabled={locked || !packing.loaded} onClick={() => setReview(true)}>{t('Preview recalculation')}</Button> : <p>{t('Waiting for the owner or an admin to review the changes.')}</p>}</div>}
          {trip.status === 'confirmed' && !trip.packingReady && !changed && manager && <><p>{t('Checklist generation is not finished. Resume without resetting existing checks.')}</p><Button disabled={locked || !packing.loaded} onClick={() => setReview(true)}>{t('Resume generation')}</Button></>}
        </section>
      </div>
      <WeatherAdvice
        key={trip.id}
        trip={{id:trip.id,name:trip.name,type:templateTripTypes[trip.type],location:trip.destination,startDate:trip.startDate,endDate:trip.endDate,people:members.length}}
        items={(packing.loaded ? packing.data?.items || [] : []).map(item=>({name:packingItemName(item,t),type:item.type,quantity:item.quantity}))}
        onAddItem={(name,type)=>addAdviceItem(controller,tripId,user?.uid || '',name,type)}
        canAddItems={manager && trip.status === 'confirmed' && trip.packingReady && packing.loaded && !locked}
        adding={locked}
      />
      {review && next && packing.data && <div className="member-removal-backdrop"><section className="panel page-panel member-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-members-title">
        <h2 id="confirm-members-title">{t(trip.status === 'confirmed' ? 'Review recalculation' : 'Confirm members')}</h2>
        <p>{t('Planned: {count}', { count: trip.plannedMemberCount })} · {t('Joined: {count}', { count: members.length })}</p>
        <p>{t(members.length !== trip.plannedMemberCount ? 'Planned: {planned}, joined: {joined}. Generate with {joined} members?' : 'Generate the packing list with these members?', { planned: trip.plannedMemberCount, joined: members.length })}</p>
        <p>{t('Existing checks, assignees and bags are preserved.')}</p>
        <ul>{next.items.map(item => { const old = packing.data!.items.find(existing => existing.id === item.id); const count = next.assignments.filter(a => a.itemId === item.id && !packing.data!.assignments.some(existing => existing.id === a.id)).length; return <li key={item.id}>{packingItemName(item, t)} · {old?.quantity || 0} → {item.quantity} {item.template ? t(item.template.unitKey) : ''} · {t('New checklists: {count}', { count })}</li>; })}</ul>
        <div className="mt-5 flex flex-wrap gap-3"><Button disabled={locked} onClick={() => void act(async () => {
          const ids = members.map(member => member.uid);
          await confirmMembers(tripId, ids, trip.status !== 'confirmed');
          if (!await packing.commitPlan(next)) throw new Error('Could not save changes.');
          await markPackingReady(tripId, ids); setReview(false);
        })}>{t(trip.status === 'confirmed' ? 'Recalculate' : 'Create packing list')}</Button><Button variant="outline" disabled={locked} autoFocus onClick={() => setReview(false)}>{t('Create later')}</Button></div>
      </section></div>}
      {packing.error && <p className="notice" role="alert">{t(packing.error)}</p>}
      {(trip.status === 'confirmed' || trip.status === 'completed') && trip.packingReady && <>
        {manager && trip.status !== 'completed' && <section className="panel page-panel"><form className="add-row" onSubmit={e => { e.preventDefault(); if (!packing.data || !bagName.trim() || locked) return; const bags = [...packing.data.bags, { id: crypto.randomUUID(), name: bagName.trim() }]; void act(async () => { const saved = await packing.mutate(current => ({ ...current, bags }), (batch, parent) => batch.update(parent, { bags, bagIds: bags.map(bag => bag.id) })); if (!saved) throw new Error('Could not save changes.'); setBagName(''); }); }}><label className="field-label">{t('Bag name')}<input required maxLength={200} value={bagName} onChange={e => setBagName(e.target.value)} disabled={locked}/></label><Button type="submit" disabled={locked}>{t('Add bag')}</Button></form></section>}
        <TripPacking managed readOnly={trip.status === 'completed' || busy} tripId={tripId} tripType={templateTripTypes[trip.type]} packing={controller} userUid={user?.uid} members={confirmed} bags={packing.data?.bags || []} legacyItems={[]}/>
      </>}
      {role === 'owner' && trip.status !== 'completed' && <div className="mt-5"><Button variant="outline" disabled={locked} onClick={() => void act(() => completeTrip(tripId))}>{t('Complete trip')}</Button></div>}
    </>}
  </TripWorkflowFrame>;
}
