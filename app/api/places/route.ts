import { NextResponse } from 'next/server';
import { fetchWeatherProvider, normalizePlaces, placeQuery } from '@/lib/weather';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get('q') || '').trim();
  const language = searchParams.get('language') === 'en' ? 'en' : 'ja';
  const { city, countryCode } = placeQuery(query);
  if (city.length < 2 || query.length > 200 || query.split(',').some(part => !part.trim())) return NextResponse.json({ error: 'Enter at least two characters to search for a place.' }, { status: 400 });
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: city, count: '10', language, format: 'json', ...(countryCode ? { countryCode } : {}) }).toString();
    const data = await fetchWeatherProvider(url) as { results?: unknown };
    if (!data || typeof data !== 'object') throw new Error('Invalid place response');
    return NextResponse.json({ places: normalizePlaces(data.results, query) });
  } catch {
    return NextResponse.json({ error: 'Could not search for places. Try again.' }, { status: 502 });
  }
}
