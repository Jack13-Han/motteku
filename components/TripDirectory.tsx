'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useTripAccount } from '@/lib/useTrips';
import { normalizeInviteCode, type Trip } from '@/lib/trips';
import { useLanguage } from '@/lib/i18n';
import TripWorkflowFrame from './TripWorkflowFrame';
import { Button } from './ui/button';

function TripCard({ id }: { id: string }) {
  const { t, date } = useLanguage();
  const [trip, setTrip] = useState<Trip | null>(null), [error, setError] = useState('');
  useEffect(() => { if (!db) return; return onSnapshot(doc(db, 'trips', id), snap => { if (snap.exists()) setTrip(snap.data() as Trip); else setError('Trip could not be loaded.'); }, () => setError('Trip could not be loaded.')); }, [id]);
  return <article className="panel page-panel"><h2>{trip?.name || t('Loading')}</h2>{error && <p role="alert">{t(error)}</p>}{trip && <><p>{trip.destination}</p><p>{date(trip.startDate)} → {date(trip.endDate)}</p><p>{t('Planned: {count}', { count: trip.plannedMemberCount })} · {t('Joined: {count}', { count: trip.joinedMemberCount })}</p><Button asChild variant="outline"><Link href={`/trips/${id}`}>{t('Open trip')}</Link></Button></>}</article>;
}

export default function TripDirectory() {
  const { user } = useTripAccount(), { t } = useLanguage(), router = useRouter();
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [code, setCode] = useState('');
  useEffect(() => {
    setIds([]); setLoaded(false);
    if (!db || !user) return;
    return onSnapshot(collection(db, 'users', user.uid, 'tripMemberships'), snap => { setIds(snap.docs.map(d => d.id)); setLoaded(true); }, () => { setError('Trips could not be loaded. Check Firestore rules.'); setLoaded(true); });
  }, [user?.uid]);
  return <TripWorkflowFrame title="Your trips">
    <div className="mb-5 flex flex-wrap gap-3"><Button asChild><Link href="/trips/new">{t('Create a draft trip')}</Link></Button></div>
    <form className="panel page-panel flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const id = normalizeInviteCode(code); if (!/^[A-Z2-9]{16}$/.test(id)) { setError('Enter a valid invitation code.'); return; } router.push(`/join/${id}`); }}><label className="field-label">{t('Invitation code')}<input required value={code} onChange={e => setCode(e.target.value)} maxLength={40} autoCapitalize="characters"/></label><Button type="submit">{t('Review invitation')}</Button></form>
    {error && <p className="notice" role="alert">{t(error)}</p>}
    {!loaded && <p role="status">{t('Loading')}</p>}
    {loaded && !ids.length && !error && <p>{t('No trips yet. Create a draft or enter an invitation code.')}</p>}
    <div className="grid gap-4 md:grid-cols-2">{ids.map(id => <TripCard key={id} id={id}/>)}</div>
  </TripWorkflowFrame>;
}
