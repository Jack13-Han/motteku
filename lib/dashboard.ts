import { isCalendarDate, isWeatherDaily, type WeatherForecast, type WeatherPlace } from './weather';

export function packingProgress(packed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(packed)) return 0;
  return Math.min(100, Math.max(0, Math.round(packed / total * 100)));
}

export function departureStatus(startDate: string, endDate: string, now = new Date()): { key: string; days?: number } {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) return { key: 'Dates to be confirmed' };
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = Date.parse(startDate + 'T00:00:00Z'), end = Date.parse(endDate + 'T00:00:00Z');
  const days = Math.round((start - today) / 86400000);
  if (days > 0) return { key: '{days} days left', days };
  if (days === 0) return { key: 'Departure today!' };
  return { key: today <= end ? 'Your adventure is underway!' : 'Memories made. Where next?' };
}

export function weatherCondition(code: number | null): string {
  if (code === 0) return 'Clear';
  if (code !== null && [1, 2, 3].includes(code)) return 'Partly cloudy';
  if (code !== null && [45, 48].includes(code)) return 'Fog';
  if (code !== null && code >= 51 && code <= 67) return 'Rain';
  if (code !== null && code >= 71 && code <= 77) return 'Snow';
  if (code !== null && code >= 80 && code <= 86) return 'Rain showers';
  if (code !== null && code >= 95) return 'Thunderstorm';
  return 'Mixed';
}

type WeatherTrip = { id: string; location: string; startDate: string; endDate: string };
export const dashboardWeatherKey = (trip: WeatherTrip, language: string) => JSON.stringify([trip.id, trip.location, trip.startDate, trip.endDate, language]);

export async function loadDashboardWeather(trip: WeatherTrip, language: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ place: WeatherPlace; forecast: WeatherForecast }> {
  if (trip.location.trim().length < 2) throw new Error('destination');
  const placesResponse = await fetcher(`/api/places?${new URLSearchParams({ q: trip.location.trim(), language })}`, { signal });
  if (!placesResponse.ok) throw new Error('places');
  const places = await placesResponse.json();
  signal.throwIfAborted();
  const place = places.places?.[0] as WeatherPlace | undefined;
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || typeof place.label !== 'string') throw new Error('destination');
  const params = new URLSearchParams({ lat: String(place.latitude), lon: String(place.longitude), startDate: trip.startDate, endDate: trip.endDate, language });
  const response = await fetcher(`/api/weather?${params}`, { signal });
  if (!response.ok) throw new Error('weather');
  const forecast = await response.json() as WeatherForecast;
  signal.throwIfAborted();
  if (!forecast.selection || !isWeatherDaily(forecast.selection.daily) || !['trip', 'partial', 'preview'].includes(forecast.selection.coverage)) throw new Error('weather');
  return { place, forecast };
}
