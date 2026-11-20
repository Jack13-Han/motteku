export interface WeatherPlace {
  id: string;
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country: string;
  countryCode: string;
}

export interface WeatherDaily {
  time: string[];
  weather_code: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_probability_max: (number | null)[];
}

export interface ForecastSelection {
  daily: WeatherDaily;
  adviceDaily: WeatherDaily | null;
  coverage: 'trip' | 'partial' | 'preview';
  availableStartDate: string;
  availableEndDate: string;
}

export interface WeatherForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: WeatherDaily;
  daily_units?: Record<string, string>;
  selection: ForecastSelection;
}

const dailyNumbers = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max'] as const;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validTripDates(startDate?: string | null, endDate?: string | null): boolean {
  return !startDate && !endDate || !!startDate && !!endDate && isCalendarDate(startDate) && isCalendarDate(endDate) && startDate <= endDate;
}

export function parseCoordinates(lat: string | null, lon: string | null): { latitude: number; longitude: number } | null {
  const numeric = (value: string | null) => value !== null && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
  if (!numeric(lat) || !numeric(lon)) return null;
  const latitude = Number(lat), longitude = Number(lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

export function isWeatherDaily(value: unknown): value is WeatherDaily {
  if (!value || typeof value !== 'object') return false;
  const daily = value as WeatherDaily;
  return Array.isArray(daily.time) && daily.time.length > 0 && daily.time.every(isCalendarDate) &&
    daily.time.every((date, index) => index === 0 || daily.time[index - 1] < date) &&
    dailyNumbers.every(key => Array.isArray(daily[key]) && daily[key].length === daily.time.length && daily[key].every(number => number === null || typeof number === 'number' && Number.isFinite(number)));
}

function takeDays(daily: WeatherDaily, indexes: number[]): WeatherDaily {
  return {
    time: indexes.map(index => daily.time[index]),
    weather_code: indexes.map(index => daily.weather_code[index]),
    temperature_2m_max: indexes.map(index => daily.temperature_2m_max[index]),
    temperature_2m_min: indexes.map(index => daily.temperature_2m_min[index]),
    precipitation_probability_max: indexes.map(index => daily.precipitation_probability_max[index]),
  };
}

// Forecasts outside the available window are previews, never fabricated trip weather.
export function selectTripForecast(forecast: { daily: WeatherDaily }, startDate?: string, endDate?: string): ForecastSelection {
  if (!isWeatherDaily(forecast.daily) || !validTripDates(startDate, endDate)) throw new Error('Invalid forecast dates.');
  const { daily } = forecast;
  const availableStartDate = daily.time[0], availableEndDate = daily.time[daily.time.length - 1];
  const indexes = daily.time.flatMap((date, index) => startDate && endDate && date >= startDate && date <= endDate ? [index] : []);
  const adviceDaily = indexes.length ? takeDays(daily, indexes) : null;
  return {
    daily: adviceDaily || takeDays(daily, daily.time.slice(0, 7).map((_, index) => index)),
    adviceDaily,
    coverage: indexes.length ? startDate! >= availableStartDate && endDate! <= availableEndDate ? 'trip' : 'partial' : 'preview',
    availableStartDate,
    availableEndDate,
  };
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[.\s]+/g, ' ').trim();
}

export function placeQuery(query: string): { city: string; country: string; region: string; countryCode: string } {
  const parts = query.split(',').map(part => part.trim()).filter(Boolean);
  const country = parts.length > 1 ? parts[parts.length - 1] : '';
  return { city: parts[0] || '', country, region: parts.length > 2 ? parts.slice(1, -1).join(', ') : '', countryCode: /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : '' };
}

export function normalizePlaces(results: unknown, query: string): WeatherPlace[] {
  if (!Array.isArray(results)) return [];
  const { country, region } = placeQuery(query);
  const labels = [new Intl.DisplayNames(['en'], { type: 'region' }), new Intl.DisplayNames(['ja'], { type: 'region' })];
  const seen = new Set<string>();
  const regionMatches = new Set<string>();
  return results.flatMap((entry): WeatherPlace[] => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !Number.isFinite(entry.latitude) || !Number.isFinite(entry.longitude) || Math.abs(entry.latitude) > 90 || Math.abs(entry.longitude) > 180) return [];
    const code = typeof entry.country_code === 'string' && /^[a-z]{2}$/i.test(entry.country_code) ? entry.country_code.toUpperCase() : '';
    const countryNames = [code, entry.country, ...labels.map(display => code ? display.of(code) : '')].filter((name): name is string => typeof name === 'string');
    if (country && !countryNames.some(name => normalized(name) === normalized(country))) return [];
    const id = String(entry.id ?? `${entry.latitude},${entry.longitude}`);
    if (seen.has(id)) return [];
    seen.add(id);
    if (region && [entry.admin1, entry.admin2, entry.admin3, entry.admin4].some(name => typeof name === 'string' && normalized(name) === normalized(region))) regionMatches.add(id);
    const label = [...new Set([entry.name, entry.admin1, entry.country].filter((name): name is string => typeof name === 'string' && !!name))].join(', ');
    return [{ id, name: entry.name, label, latitude: entry.latitude, longitude: entry.longitude, timezone: typeof entry.timezone === 'string' ? entry.timezone : 'UTC', country: typeof entry.country === 'string' ? entry.country : '', countryCode: code }];
  // Region labels can change language (Tokyo / 東京都). Prefer exact matches,
  // while keeping country-qualified choices selectable when labels differ.
  }).sort((a, b) => Number(regionMatches.has(b.id)) - Number(regionMatches.has(a.id)));
}

export async function fetchWeatherProvider(url: URL): Promise<unknown> {
  // Bound each attempt so a stalled provider cannot leave the UI loading forever.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, { signal: controller.signal, next: { revalidate: 900 } });
      if (!response.ok) throw new Error('Weather service unavailable');
      return await response.json();
    } catch (error) {
      if (attempt === 1) throw error;
    } finally { clearTimeout(timeout); }
  }
  throw new Error('Weather service unavailable');
}
