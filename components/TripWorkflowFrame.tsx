'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import { useTripAccount } from '@/lib/useTrips';
import { Button } from './ui/button';

export default function TripWorkflowFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const { t, language, setLanguage } = useLanguage();
  const { user, ready, configured } = useTripAccount();
  const next = encodeURIComponent(usePathname());
  return <main className="managed-shell">
    <header className="managed-header"><Link className="managed-brand" href="/">Motteku</Link><nav><Link href="/trips">{t('Your trips')}</Link><select aria-label={t('Language')} value={language} onChange={e => setLanguage(e.target.value as 'ja' | 'en')}><option value="ja">{t('Japanese')}</option><option value="en">{t('English')}</option></select></nav></header>
    <h1>{t(title)}</h1>
    {!ready ? <p role="status">{t('Loading')}</p> : !configured ? <p className="notice" role="alert">{t('Firebase Authentication is not configured. Check your Firebase project settings.')}</p> : !user ? <section className="panel page-panel"><p>{t('Sign in with an account to manage trips.')}</p><div className="flex flex-wrap gap-3"><Button asChild><Link href={`/login?next=${next}`}>{t('Log in')}</Link></Button><Button asChild variant="outline"><Link href={`/register?next=${next}`}>{t('Register')}</Link></Button><Button asChild variant="outline"><Link href="/">{t('Cancel')}</Link></Button></div></section> : children}
  </main>;
}
