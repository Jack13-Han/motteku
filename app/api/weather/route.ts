import { NextResponse } from 'next/server';
import { fetchWeatherProvider, isWeatherDaily, parseCoordinates, selectTripForecast, validTripDates } from '@/lib/weather';
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const coordinates = parseCoordinates(searchParams.get('lat'), searchParams.get('lon'));
  if (!coordinates) return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
  const startDate = searchParams.get('startDate') || undefined, endDate = searchParams.get('endDate') || undefined;
  if (!validTripDates(startDate, endDate)) return NextResponse.json({ error: 'Invalid trip dates.' }, { status: 400 });
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(coordinates.latitude), longitude: String(coordinates.longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '16' }).toString();
    const data = await fetchWeatherProvider(url) as Record<string, unknown>;
    if (!data || !isWeatherDaily(data.daily) || typeof data.timezone !== 'string' || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) throw new Error('Invalid weather response');
    return NextResponse.json({ latitude: data.latitude, longitude: data.longitude, timezone: data.timezone, daily: data.daily, daily_units: data.daily_units, selection: selectTripForecast({ daily: data.daily }, startDate, endDate) });
  } catch {
    return NextResponse.json({ error: 'Could not load weather right now.' }, { status: 502 });
  }
}
