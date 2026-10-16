import { NextResponse } from 'next/server';
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat') ?? '34.6937');
  const lon = Number(searchParams.get('lon') ?? '135.5023');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return NextResponse.json({error:'Invalid coordinates'}, {status:400});
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({latitude:String(lat),longitude:String(lon),daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:'auto',forecast_days:'7'}).toString();
    const response = await fetch(url, { next: { revalidate: 1800 } });
    if (!response.ok) throw new Error('Weather service unavailable');
    return NextResponse.json(await response.json());
  } catch { return NextResponse.json({error:'Could not load weather right now.'},{status:502}); }
}
