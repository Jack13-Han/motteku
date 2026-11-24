'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { checkpointTitle, checkProgress, nextTravelCheck } from '@/lib/travelChecks';
import type { TravelCheckController } from '@/lib/useTravelChecks';

export default function NextCheckCard({ controller, packedCount, onOpen }: { controller: TravelCheckController; packedCount: number; onOpen: () => void }) {
  const { t, date } = useLanguage();
  const [deferred, setDeferred] = useState(false);
  const check = nextTravelCheck(controller.availableChecks || controller.checks);
  const needsStays = controller.plan.accommodationMode === 'multiple' && controller.plan.stays.length < 2;
  return <section className="panel travel-next-card"><div className="panel-head"><h3><ShieldCheck size={18}/> {t('Next item check')}</h3></div>
    {needsStays && !deferred ? <><h4>{t('Set up your stays')}</h4><p>{t('Register accommodation and checkout times to create moving checks.')}</p><div className="bottom-actions"><button className="primary" onClick={onOpen}>{t('Add accommodations')}</button><button className="soft-button" onClick={() => setDeferred(true)}>{t('Set up later')}</button></div></> : <>
      {!controller.loaded ? <p>{t('Loading item checks…')}</p> : check ? <><h4>{t(checkpointTitle(check))}</h4>{check.fromLocation && <p>{check.fromLocation} → {check.toLocation || t('Home')}</p>}<p>{check.scheduledAt ? date(check.scheduledAt, true) : t('Set a checkout time')}</p><strong>{t('Unresolved items: {count}', { count: check.snapshotAt ? checkProgress(check).unresolved.length : packedCount })}</strong></> : <p>{t('All item checks are completed.')}</p>}
      <button className="primary" onClick={onOpen}>{t(check ? 'Start check' : 'Open item checks')}</button>
      {needsStays && <button className="text-button" onClick={onOpen}>{t('Add accommodations')}</button>}
    </>}{controller.error && <div role="alert"><p>{t(controller.error)}</p><button className="soft-button" disabled={controller.busy} onClick={controller.retry}>{t('Retry')}</button></div>}
  </section>;
}
