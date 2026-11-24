'use client';
import { useLanguage } from '@/lib/i18n';
import { accommodationLabels, type AccommodationMode } from '@/lib/travelChecks';

export default function AccommodationModeSelect({ value, onChange, disabled = false }: { value: AccommodationMode; onChange: (value: AccommodationMode) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return <label>{t('Accommodation plan')}<select value={value} disabled={disabled} onChange={event => onChange(event.target.value as AccommodationMode)}>{(Object.keys(accommodationLabels) as AccommodationMode[]).map(mode => <option key={mode} value={mode}>{t(accommodationLabels[mode])}</option>)}</select></label>;
}
