'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTripAccount } from '@/lib/useTrips';
import { invitationUsable, normalizeInviteCode, type TripInvitation } from '@/lib/trips';
import { joinTrip } from '@/lib/tripService';
import { useLanguage } from '@/lib/i18n';
import { errorKey } from '@/lib/messages';
import TripWorkflowFrame from './TripWorkflowFrame';
import { Button } from './ui/button';

export default function TripJoin({ inviteId }: { inviteId: string }) {
  const { user, ready, configured } = useTripAccount(), { t, date } = useLanguage(), router = useRouter();
  const [invite, setInvite] = useState<TripInvitation | null>(null), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [alreadyJoined, setAlreadyJoined] = useState(false);
  useEffect(() => {
    if (ready && configured && !user && /^[A-Z2-9]{16}$/.test(normalizeInviteCode(inviteId))) router.replace(`/login?next=${encodeURIComponent(`/join/${normalizeInviteCode(inviteId)}`)}`);
  }, [ready, configured, user?.uid, inviteId, router]);
  useEffect(() => {
    setInvite(null); setError(''); setLoaded(false); setAlreadyJoined(false);
    if (!db || !user) return;
    if (!/^[A-Z2-9]{16}$/.test(normalizeInviteCode(inviteId))) { setError('This invitation is invalid, expired or full.'); setLoaded(true); return; }
    const database = db, uid = user.uid;
    let cancelled = false;
    const stop = onSnapshot(doc(database, 'tripInvitations', normalizeInviteCode(inviteId)), snap => {
      if (!snap.exists() || !invitationUsable(snap.data() as TripInvitation)) { setError('This invitation is invalid, expired or full.'); setLoaded(true); return; }
      const value = snap.data() as TripInvitation; setInvite(value); setLoaded(true);
      void getDoc(doc(database, 'trips', value.tripId, 'tripMembers', uid)).then(member => { if (!cancelled) setAlreadyJoined(member.exists()); }).catch(() => { if (!cancelled) setError('Could not join this trip. Refresh the invitation and try again.'); });
    }, () => { setError('This invitation is invalid, expired or full.'); setLoaded(true); });
    return () => { cancelled = true; stop(); };
  }, [inviteId, user?.uid]);
  return <TripWorkflowFrame title="Review invitation">
    {!loaded && <p role="status">{t('Loading')}</p>}
    {error && <p className="notice" role="alert">{t(error)}</p>}
    {invite && <section className="panel page-panel"><h2>{invite.preview.name}</h2><dl className="managed-details">
      <dt>{t('Destination')}</dt><dd>{invite.preview.destination}</dd>
      <dt>{t('Trip dates')}</dt><dd>{date(invite.preview.startDate)} → {date(invite.preview.endDate)}</dd>
      <dt>{t('Owner')}</dt><dd>{invite.preview.ownerName}</dd>
      <dt>{t('Planned members')}</dt><dd>{invite.preview.plannedMemberCount}</dd>
      <dt>{t('Joined members')}</dt><dd>{invite.preview.joinedMemberCount}</dd>
    </dl><div className="mt-5 flex flex-wrap gap-3">
      {alreadyJoined ? <Button asChild><Link href={`/trips/${invite.tripId}`}>{t('Open trip')}</Link></Button> : <Button disabled={busy || !!error} onClick={async () => { if (busy) return; setBusy(true); setError(''); try { router.push(`/trips/${await joinTrip(inviteId, user)}`); } catch (e) { setError(errorKey(e, 'Could not join this trip. Refresh the invitation and try again.')); setBusy(false); } }}>{t(busy ? 'Please wait…' : 'Join trip')}</Button>}
      <Button asChild variant="outline"><Link href="/trips">{t('Cancel')}</Link></Button>
    </div>{alreadyJoined && <p>{t('You have already joined this trip.')}</p>}</section>}
  </TripWorkflowFrame>;
}
