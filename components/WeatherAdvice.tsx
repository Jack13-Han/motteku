'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudSun, LoaderCircle, MapPin, Plus, RefreshCw, Search, Sparkles, Check } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import type { WeatherForecast, WeatherPlace } from '@/lib/weather';

type Trip = { id: string; name: string; type: string; location: string; startDate: string; endDate: string; people: number };
type Item = { name: string; type?: string; quantity?: number; status?: string };
type Advice = { source: 'gemini' | 'built-in'; reason?: string; result: { advice: string; suggestedItems: string[]; cautions: string[] } };
type Props = { trip: Trip; items: Item[]; onDestinationChange?: (label: string) => void; onAddItem?: (name: string, type: 'personal' | 'shared') => Promise<boolean>; canAddItems?: boolean; adding?: boolean };

function weatherKey(code: number | null) {
  if (code === 0) return 'Clear';
  if (code !== null && [1, 2, 3].includes(code)) return 'Partly cloudy';
  if (code !== null && [45, 48].includes(code)) return 'Fog';
  if (code !== null && code >= 51 && code <= 67) return 'Rain';
  if (code !== null && code >= 71 && code <= 77) return 'Snow';
  if (code !== null && code >= 80 && code <= 86) return 'Rain showers';
  if (code !== null && code >= 95) return 'Thunderstorm';
  return 'Mixed';
}

async function readJson(url: string, controller: AbortController, options?: RequestInit) {
  const timeout = setTimeout(() => controller.abort('timeout'), 35000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body;
  } finally { clearTimeout(timeout); }
}

export default function WeatherAdvice({ trip, items, onDestinationChange, onAddItem, canAddItems = false, adding = false }: Props) {
  const { language, t, date } = useLanguage();
  const [query, setQuery] = useState(trip.location);
  const [places, setPlaces] = useState<WeatherPlace[]>([]);
  const [selected, setSelected] = useState<WeatherPlace | null>(null);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [searching, setSearching] = useState(false), [weatherLoading, setWeatherLoading] = useState(false), [adviceLoading, setAdviceLoading] = useState(false);
  const [error, setError] = useState(''), [adviceError, setAdviceError] = useState(''), [advice, setAdvice] = useState<Advice | null>(null);
  const [itemType, setItemType] = useState<'personal' | 'shared'>('personal'), [savingItem, setSavingItem] = useState(''), [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const searchRequest = useRef<AbortController | null>(null), forecastRequest = useRef<AbortController | null>(null), adviceRequest = useRef<AbortController | null>(null);
  const ownDestinationChange = useRef<{ tripId: string; label: string } | null>(null);

  function clearResults() {
    forecastRequest.current?.abort(); adviceRequest.current?.abort();
    setSelected(null); setForecast(null); setAdvice(null); setAdviceError(''); setNotice(''); setWeatherLoading(false); setAdviceLoading(false);
  }

  async function searchPlaces(value: string, autoSelect = false) {
    searchRequest.current?.abort(); clearResults(); setPlaces([]); setError('');
    if (value.trim().length < 2) { setSearching(false); setError('Enter at least two characters to search for a place.'); return; }
    const controller = new AbortController(); searchRequest.current = controller; setSearching(true);
    try {
      const body = await readJson(`/api/places?q=${encodeURIComponent(value.trim())}&language=${language}`, controller);
      if (controller.signal.aborted) return;
      const results = body.places as WeatherPlace[];
      setPlaces(results);
      if (!results.length) setError('No matching places. Try a city and country.');
      else if (results.length === 1 && !autoSelect) selectPlace(results[0]);
      else if (autoSelect) setSelected(results[0]);
    } catch (e) {
      if (!controller.signal.aborted || controller.signal.reason === 'timeout') setError('Could not search for places. Please try again.');
    } finally { if (searchRequest.current === controller) setSearching(false); }
  }

  useEffect(() => {
    if (ownDestinationChange.current?.tripId === trip.id && ownDestinationChange.current.label === trip.location) { ownDestinationChange.current = null; return; }
    setQuery(trip.location);
    void searchPlaces(trip.location, true);
  }, [trip.id, trip.location]);

  useEffect(() => {
    adviceRequest.current?.abort(); setAdvice(null); setAdviceError(''); setAdviceLoading(false);
    if (!selected) return;
    const controller = new AbortController(); forecastRequest.current?.abort(); forecastRequest.current = controller;
    setForecast(null); setWeatherLoading(true); setError('');
    const params = new URLSearchParams({ lat: String(selected.latitude), lon: String(selected.longitude), startDate: trip.startDate, endDate: trip.endDate, language });
    void readJson(`/api/weather?${params}`, controller).then(body => {
      if (!controller.signal.aborted) setForecast(body as WeatherForecast);
    }).catch(() => {
      if (!controller.signal.aborted || controller.signal.reason === 'timeout') setError('Could not load weather right now.');
    }).finally(() => { if (forecastRequest.current === controller) setWeatherLoading(false); });
    return () => { controller.abort(); adviceRequest.current?.abort(); };
  }, [selected, trip.startDate, trip.endDate, trip.type, trip.people, language, refresh]);

  useEffect(() => () => { searchRequest.current?.abort(); forecastRequest.current?.abort(); adviceRequest.current?.abort(); }, []);

  function selectPlace(place: WeatherPlace) {
    clearResults(); setSelected(place); setQuery(place.label);
    if (onDestinationChange && place.label !== trip.location) { ownDestinationChange.current = { tripId: trip.id, label: place.label }; onDestinationChange(place.label); }
  }

  async function generateAdvice() {
    if (!selected || adviceLoading || searching || weatherLoading) return;
    const controller = new AbortController(); adviceRequest.current?.abort(); adviceRequest.current = controller;
    setAdviceLoading(true); setAdviceError(''); setAdvice(null);
    try {
      const uniqueItems = [...new Map(items.map(item => [item.name.trim().toLocaleLowerCase(), item])).values()];
      const body = await readJson('/api/advice', controller, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, trip: { ...trip, location: selected.label }, weather: forecast?.selection.adviceDaily || null, items: uniqueItems }) });
      if (!controller.signal.aborted) setAdvice(body as Advice);
    } catch {
      if (!controller.signal.aborted || controller.signal.reason === 'timeout') setAdviceError('Advice could not be generated. Please try again.');
    } finally { if (adviceRequest.current === controller) setAdviceLoading(false); }
  }

  async function addItem(name: string) {
    if (!onAddItem || !canAddItems || savingItem || adding) return;
    setSavingItem(name); setNotice('');
    try {
      if (!await onAddItem(name, itemType)) throw new Error('save');
      setNotice(t('{name} added to the packing list.', { name }));
    } catch { setNotice(t('Could not save changes.')); }
    finally { setSavingItem(''); }
  }

  const daily = forecast?.selection.daily;
  return <div className="content-grid weather-advice">
    <section className="panel page-panel">
      <div className="panel-head"><div><h3>{t('Destination forecast')}</h3><p>{t('Choose a place to see its weather.')}</p></div><CloudSun className="muted-icon" /></div>
      <form onSubmit={e => { e.preventDefault(); void searchPlaces(query); }} className="weather-search">
        <label className="field-label">{t('Destination or city')}<input value={query} maxLength={200} onChange={e => { searchRequest.current?.abort(); clearResults(); setPlaces([]); setSearching(false); setError(''); setQuery(e.target.value); }} placeholder={t('Example: Tokyo, Japan')} /></label>
        <button className="primary" type="submit" disabled={searching}>{searching ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{t('Search places')}</button>
      </form>
      {searching && <p role="status">{t('Searching for places…')}</p>}
      {places.length > 0 && <div className="weather-places" aria-label={t('Matching places')}><p className="helper-note">{t('Select the correct city and country.')}</p>{places.map(place => <button type="button" className={`weather-place ${selected?.id === place.id ? 'selected' : ''}`} aria-pressed={selected?.id === place.id} key={place.id} onClick={() => selectPlace(place)}><MapPin size={16} /><span>{place.label}</span>{selected?.id === place.id && <Check size={16} />}</button>)}</div>}
      {error && <p className="notice" role="alert">{t(error)}</p>}
      {selected && <div className="weather-selected"><strong><MapPin size={16} />{selected.label}</strong><button type="button" className="text-button" disabled={weatherLoading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} />{t('Refresh forecast')}</button></div>}
      {weatherLoading && <p role="status"><LoaderCircle className="spin" size={16} /> {t('Loading forecast…')}</p>}
      {forecast && daily && <>
        <p className="helper-note">{t(forecast.selection.coverage === 'preview' ? 'Trip forecast is not available. Showing upcoming weather for this destination.' : forecast.selection.coverage === 'partial' ? 'Forecast covers part of your trip. Check again closer to departure.' : 'Forecast for your trip dates.')}</p>
        <div className="forecast-grid">{daily.time.map((day, index) => <div className="forecast-day" key={day}><small>{date(day)}</small><CloudSun size={24} /><b>{daily.temperature_2m_max[index] == null ? '—' : Math.round(daily.temperature_2m_max[index]!)}° / {daily.temperature_2m_min[index] == null ? '—' : Math.round(daily.temperature_2m_min[index]!)}°</b><span>{t(weatherKey(daily.weather_code[index]))}</span><small>{daily.precipitation_probability_max[index] ?? '—'}% {t('rain')}</small></div>)}</div>
        <p className="helper-note">{t('Weather by Open-Meteo. Forecasts can change.')}</p>
      </>}
    </section>
    <section className="panel page-panel">
      <div className="panel-head"><div><h3>{t('Smart packing advice')}</h3><p>{t('Suggestions based on this destination, your trip and your checklist.')}</p></div><Sparkles className="muted-icon" /></div>
      {!selected && <p className="helper-note">{t('Choose a destination first.')}</p>}
      <button type="button" className="primary" disabled={!selected || searching || weatherLoading || adviceLoading} onClick={() => void generateAdvice()}>{adviceLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{t('Generate suggestions')}</button>
      {adviceError && <p className="notice" role="alert">{t(adviceError)}</p>}
      {advice && <div className="advice-results">
        <span className="packing-badge">{t(advice.source === 'gemini' ? 'Gemini AI suggestions' : 'Built-in suggestions')}</span>
        {advice.reason === 'unavailable' && <p className="helper-note">{t('AI is temporarily unavailable. These practical suggestions are generated without AI.')}</p>}
        {advice.reason === 'not-configured' && <p className="helper-note">{t('These practical suggestions work without an AI connection.')}</p>}
        <h4>{t('Recommendation')}</h4><p>{advice.result.advice}</p>
        {advice.result.suggestedItems.length > 0 && <>
          <h4>{t('Suggested items')}</h4>
          {canAddItems && <label className="field-label">{t('Add suggestions as')}<select value={itemType} onChange={e => setItemType(e.target.value as 'personal' | 'shared')}><option value="personal">{t('Personal')}</option><option value="shared">{t('Shared')}</option></select></label>}
          <div className="weather-suggestions">{advice.result.suggestedItems.map(name => { const exists = items.some(item => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()); return <button type="button" className="suggestion-chip" key={name} disabled={!canAddItems || exists || Boolean(savingItem) || adding} onClick={() => void addItem(name)}>{savingItem === name ? <LoaderCircle className="spin" size={13} /> : exists ? <Check size={13} /> : <Plus size={13} />}{name}{exists && <small>{t('Already added')}</small>}</button>; })}</div>
          {!canAddItems && <p className="helper-note">{t('Only the organizer or an admin can add suggested items.')}</p>}
        </>}
        {advice.result.cautions.length > 0 && <><h4>{t('Things to remember')}</h4><ul>{advice.result.cautions.map(value => <li key={value}>{value}</li>)}</ul></>}
      </div>}
      {notice && <p role="status">{notice}</p>}
    </section>
  </div>;
}
