'use client';

import { useEffect, useState } from 'react';
import { Backpack, BriefcaseBusiness, CalendarDays, Camera, Clock3, CloudSun, Flag, Heart, LoaderCircle, MapPin, ShoppingBag, Sparkles, Sun, Trash2, Wallet, Zap } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { dashboardWeatherKey, departureStatus, loadDashboardWeather, packingProgress, weatherCondition } from '@/lib/dashboard';
import { sortedActivities, type TripActivity } from '@/lib/itinerary';
import type { WeatherForecast, WeatherPlace } from '@/lib/weather';

type DashboardTrip = { id: string; name: string; type: string; location: string; startDate: string; endDate: string; budget: number; activities?: TripActivity[] };
type Props = { trip: DashboardTrip; packed: number; total: number; spent: number; onNavigate: (tab: string) => void; onDeleteTrip?: () => void };
type WeatherState = { key: string; status: 'loading' | 'ready' | 'error'; place?: WeatherPlace; forecast?: WeatherForecast };

export default function TravelDashboard({ trip, packed, total, spent, onNavigate, onDeleteTrip }: Props) {
  const { language, t, date } = useLanguage();
  const key = dashboardWeatherKey(trip, language);
  const [weather, setWeather] = useState<WeatherState>({ key: '', status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setWeather({ key, status: 'loading' });
    void loadDashboardWeather(trip, language, controller.signal).then(result => {
      if (active && !controller.signal.aborted) setWeather({ key, status: 'ready', ...result });
    }).catch(() => { if (active) setWeather({ key, status: 'error' }); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [key]);

  const progress = packingProgress(packed, total);
  const departure = departureStatus(trip.startDate, trip.endDate);
  const activities = sortedActivities(trip.activities).slice(0, 3);
  const yen = (value: number) => new Intl.NumberFormat(language === 'ja' ? 'ja-JP' : 'en-US', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
  const currentWeather = weather.key === key ? weather : { key, status: 'loading' } as WeatherState;
  const daily = currentWeather.forecast?.selection.daily;
  const high = daily?.temperature_2m_max[0], low = daily?.temperature_2m_min[0];
  const dayNumber = (activityDate: string) => Math.max(1, Math.round((Date.parse(activityDate + 'T00:00:00Z') - Date.parse(trip.startDate + 'T00:00:00Z')) / 86400000) + 1);
  const shortDate = (value: string) => {
    const day = new Date(value + 'T12:00:00');
    return Number.isFinite(day.getTime()) ? new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', weekday: 'short' }).format(day) : value;
  };
  return <div className="travel-dashboard">
    <div className="travel-top-grid">
      <section className="travel-hero" style={{ backgroundImage: 'url(/images/japan-travel-hero.webp)' }} aria-label={t('Your next adventure')}>
        {onDeleteTrip && <button type="button" className="travel-hero-delete" onClick={onDeleteTrip} aria-label={t('Delete trip')} title={t('Delete trip')}><Trash2 size={17} /></button>}
        <div className="travel-hero-content">
          <span className="travel-hero-kicker"><Sparkles size={15} />{t('Your next adventure')}</span>
          <h2>{trip.name}</h2>
          <div className="travel-hero-meta"><span><MapPin size={20} />{trip.location}</span><span><CalendarDays size={20} />{date(trip.startDate)} – {date(trip.endDate)}</span></div>
          <div className="travel-hero-bottom"><button className="travel-hero-button" type="button" onClick={() => onNavigate('Itinerary')}>{t('View details')}</button><span className="travel-good-trip">{t('Good trip!')}</span></div>
        </div>
      </section>
      <section className="travel-progress" aria-label={t('Trip progress')}>
        <div className="travel-progress-ring">
          <svg viewBox="0 0 160 160" aria-hidden="true"><circle className="travel-ring-track" cx="80" cy="80" r="65" fill="none" strokeWidth="14" /><circle className="travel-ring-value" cx="80" cy="80" r="65" fill="none" strokeWidth="14" strokeLinecap="round" pathLength="100" strokeDasharray={`${progress} 100`} transform="rotate(-90 80 80)" /></svg>
          <div className="travel-ring-label"><strong>{progress}%</strong><span>{t('Packing progress')}</span></div>
        </div>
        <div className="travel-departure"><strong><Flag size={19} />{t(departure.key, { days: departure.days ?? 0 })}</strong><span>{t('Enjoy every little moment.')}</span></div>
      </section>
      <div className="travel-summary-grid">
        <button className="travel-summary-card travel-packing" type="button" onClick={() => onNavigate('Packing list')}>
          <span className="travel-stat-icon"><Backpack size={23} /></span><span className="travel-stat-copy"><strong>{t('Packing progress')}</strong><b>{progress}%</b><span className="travel-mini-meter" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span><small>{t('{packed} / {total} items', { packed, total })}</small></span><Backpack className="travel-stat-art" size={76} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button className="travel-summary-card travel-budget" type="button" onClick={() => onNavigate('Budget')}>
          <span className="travel-stat-icon"><Wallet size={23} /></span><span className="travel-stat-copy"><strong>{t('Budget summary')}</strong><b>{yen(trip.budget)}</b><small>{t('{amount} spent', { amount: yen(spent) })}</small></span><span className="travel-budget-bars" aria-hidden="true">{[18, 30, 24, 46, 62, 85].map((height, index) => <i key={index} style={{ height }} />)}</span>
        </button>
        <button className="travel-summary-card travel-weather" type="button" onClick={() => onNavigate('Weather & AI')}>
          <span className="travel-stat-icon"><Sun size={29} /></span><span className="travel-stat-copy"><strong>{t('Weather')}<span className="travel-weather-place">{currentWeather.place?.name || trip.location}</span></strong>
            {currentWeather.status === 'loading' ? <small className="travel-weather-status"><LoaderCircle size={17} className="spin" />{t('Loading forecast…')}</small> : currentWeather.status === 'error' ? <small className="travel-weather-status">{t('Forecast unavailable. Open weather to try again.')}</small> : <><b>{high == null ? '—' : `${Math.round(high)}°C`}</b><span className="travel-weather-condition">{t(weatherCondition(daily?.weather_code[0] ?? null))}</span><small className="travel-weather-temperatures">{t('High {high}° · Low {low}°', { high: high == null ? '—' : Math.round(high), low: low == null ? '—' : Math.round(low) })}</small><small className="travel-weather-date">{daily?.time[0] ? shortDate(daily.time[0]) : ''} · {t(currentWeather.forecast?.selection.coverage === 'preview' ? 'Upcoming weather' : currentWeather.forecast?.selection.coverage === 'partial' ? 'Partial trip forecast' : 'Trip forecast')}</small></>}
          </span><CloudSun className="travel-stat-art" size={72} strokeWidth={1.2} aria-hidden="true" />
        </button>
      </div>
    </div>
    <div className="travel-bottom-grid">
      <section className="travel-itinerary-card">
        <div className="travel-section-head"><h3><CalendarDays size={24} />{t('Trip itinerary')}</h3><button className="text-button" type="button" onClick={() => onNavigate('Itinerary')}>{t('View all')}</button></div>
        {activities.length ? <div className="travel-activity-list">{activities.map(activity => {
          const Icon = activity.category === 'Shopping' ? ShoppingBag : activity.category === 'Food' ? Heart : activity.category === 'Travel' ? BriefcaseBusiness : Camera;
          return <button className="travel-activity-row" key={activity.id} type="button" onClick={() => onNavigate('Itinerary')}>
            <span className="travel-day"><strong>{t('Day {number}', { number: dayNumber(activity.date) })}</strong><small>{shortDate(activity.date)}</small></span><span className={`travel-activity-thumb travel-thumb-${activity.category.toLowerCase()}`}><Icon size={31} strokeWidth={1.4} /></span>
            <span className="travel-activity-info"><strong>{activity.title}</strong><span>{activity.location && <span><MapPin size={14} />{activity.location}</span>}{activity.startTime && <span><Clock3 size={14} />{activity.startTime}{activity.endTime ? ` – ${activity.endTime}` : ''}</span>}</span></span><span className={`travel-category travel-category-${activity.category.toLowerCase()}`}>{t(activity.category)}</span>
          </button>;
        })}</div> : <div className="travel-itinerary-empty"><span className="travel-empty-icon"><CalendarDays size={32} /></span><h4>{t('Make room for new memories.')}</h4><p>{t('Add your first activity and bring the journey together.')}</p><button className="primary" type="button" onClick={() => onNavigate('Itinerary')}>{t('Add activity')}</button></div>}
      </section>
      <div className="travel-side-stack">
        <section className="travel-quick-card"><div className="travel-section-head"><h3><Zap size={24} />{t('Quick actions')}</h3></div><div className="travel-quick-grid">
          <button type="button" className="travel-quick-action travel-quick-purple" onClick={() => onNavigate('Itinerary')}><BriefcaseBusiness size={30} /><span>{t('Add activity')}</span></button>
          <button type="button" className="travel-quick-action travel-quick-green" onClick={() => onNavigate('Packing list')}><ShoppingBag size={30} /><span>{t('View packing')}</span></button>
          <button type="button" className="travel-quick-action travel-quick-peach" onClick={() => onNavigate('Budget')}><Wallet size={30} /><span>{t('Set budget')}</span></button>
          <button type="button" className="travel-quick-action travel-quick-blue" onClick={() => onNavigate('Weather & AI')}><CloudSun size={32} /><span>{t('Check weather')}</span></button>
        </div></section>
        <section className="travel-journey-banner"><img src="/images/journey-cat.webp" alt="" /><div className="travel-journey-copy"><span>{t('Happy journey!')}</span><Heart size={23} aria-hidden="true" /></div></section>
      </div>
    </div>
  </div>;
}
