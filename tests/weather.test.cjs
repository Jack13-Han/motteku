const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function harness(fetcher, timers = {}) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', 'fetch', 'setTimeout', 'clearTimeout', source)(exports, name => name === 'next/server' ? { NextResponse: Response } : name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name), fetcher, timers.setTimeout || setTimeout, timers.clearTimeout || clearTimeout);
    cache.set(relative, exports);
    return exports;
  }
  return { weather: load('lib/weather.ts'), forecast: load('app/api/weather/route.ts').GET, places: load('app/api/places/route.ts').GET };
}

function daily(first = '2026-11-06', length = 16) {
  return { time: Array.from({ length }, (_, index) => new Date(Date.parse(first + 'T00:00:00Z') + index * 86400000).toISOString().slice(0, 10)), weather_code: Array(length).fill(0), temperature_2m_max: Array(length).fill(20), temperature_2m_min: Array(length).fill(10), precipitation_probability_max: Array(length).fill(5) };
}
const forecastData = (latitude = 35.68, longitude = 139.69) => ({ latitude, longitude, timezone: 'Asia/Tokyo', daily: daily(), daily_units: { temperature_2m_max: '°C' } });
const request = (path) => new Request('http://localhost' + path);
const place = (id, name, country, code, latitude, longitude, admin1) => ({ id, name, country, country_code: code, latitude, longitude, admin1, timezone: code === 'JP' ? 'Asia/Tokyo' : 'Europe/Paris' });

test('weather rejects missing, blank, nondecimal and out-of-range coordinates without contacting the provider', async () => {
  let calls = 0;
  const { forecast } = harness(async () => { calls++; throw new Error('must not fetch'); });
  for (const query of ['', '?lat=&lon=', '?lat=NaN&lon=0', '?lat=91&lon=0', '?lat=0&lon=-181', '?lat=0x20&lon=1', '?lat=0']) assert.equal((await forecast(request('/api/weather' + query))).status, 400);
  assert.equal(calls, 0);
});

test('selected city coordinates reach Open-Meteo; different cities never default to Osaka', async () => {
  const seen = [];
  const { forecast } = harness(async (url, options) => {
    seen.push(url);
    assert.equal(options.signal instanceof AbortSignal, true);
    return Response.json(forecastData(Number(url.searchParams.get('latitude')), Number(url.searchParams.get('longitude'))));
  });
  for (const [latitude, longitude] of [[35.68, 139.69], [48.85, 2.35], [0, 0]]) {
    const response = await forecast(request(`/api/weather?lat=${latitude}&lon=${longitude}&startDate=2026-11-10&endDate=2026-11-12`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.latitude, latitude); assert.equal(body.longitude, longitude);
    assert.equal(body.daily.time.length, 16);
    assert.equal(body.selection.coverage, 'trip');
    assert.deepEqual(body.selection.daily.time, ['2026-11-10', '2026-11-11', '2026-11-12']);
  }
  assert.equal(seen.length, 3);
  assert.equal(seen[0].searchParams.get('latitude'), '35.68');
  assert.equal(seen[1].searchParams.get('longitude'), '2.35');
  assert.equal(seen[0].searchParams.get('forecast_days'), '16');
});

test('distant, past and undated trips show labelled previews without sending unrelated weather to advice', () => {
  const { weather } = harness(() => {});
  for (const dates of [['2027-01-01', '2027-01-03'], ['2025-01-01', '2025-01-03'], [undefined, undefined]]) {
    const selected = weather.selectTripForecast({ daily: daily() }, ...dates);
    assert.equal(selected.coverage, 'preview');
    assert.equal(selected.daily.time.length, 7);
    assert.equal(selected.adviceDaily, null);
    assert.equal(selected.availableStartDate, '2026-11-06');
    assert.equal(selected.availableEndDate, '2026-11-21');
  }
});

test('partially available trips include only overlapping dates and preserve unknown weather values', () => {
  const { weather } = harness(() => {});
  const data = daily(); data.temperature_2m_min[15] = null;
  const selected = weather.selectTripForecast({ daily: data }, '2026-11-20', '2026-11-25');
  assert.equal(selected.coverage, 'partial');
  assert.deepEqual(selected.adviceDaily.time, ['2026-11-20', '2026-11-21']);
  assert.deepEqual(selected.adviceDaily.temperature_2m_min, [10, null]);
  assert.deepEqual(selected.daily, selected.adviceDaily);
});

test('invalid/reversed/impossible trip dates fail before provider access', async () => {
  let calls = 0;
  const { forecast } = harness(async () => { calls++; throw new Error('must not fetch'); });
  for (const query of ['startDate=2026-02-30&endDate=2026-03-02', 'startDate=2026-11-10&endDate=2026-11-01', 'startDate=2026-11-10', 'startDate=bad&endDate=bad']) assert.equal((await forecast(request('/api/weather?lat=0&lon=0&' + query))).status, 400);
  assert.equal(calls, 0);
});

test('place searches retain country qualifiers and expose selectable matching cities', async () => {
  const seen = [];
  const { places } = harness(async url => {
    seen.push(url);
    return Response.json({ results: url.searchParams.get('name') === 'Tokyo' ? [place(1, '東京', '日本', 'JP', 35.68, 139.69, '東京都'), place(2, 'Tokyo', 'United States', 'US', 40, -90, 'Texas')] : [place(3, 'Paris', 'France', 'FR', 48.85, 2.35, 'Île-de-France'), place(4, 'Paris', 'United States', 'US', 33.66, -95.55, 'Texas')] });
  });
  const tokyo = await (await places(request('/api/places?q=Tokyo%2C%20Japan&language=ja'))).json();
  assert.deepEqual(tokyo.places.map(place => place.countryCode), ['JP']);
  assert.equal(tokyo.places[0].latitude, 35.68);
  const paris = await (await places(request('/api/places?q=Paris%2C%20France&language=en'))).json();
  assert.deepEqual(paris.places.map(place => place.countryCode), ['FR']);
  const ambiguous = await (await places(request('/api/places?q=Paris&language=en'))).json();
  assert.equal(ambiguous.places.length, 2);
  const us = await (await places(request('/api/places?q=Paris%2C%20Texas%2C%20US&language=en'))).json();
  assert.deepEqual(us.places.map(place => place.countryCode), ['US']);
  assert.equal(us.places[0].id, '4');
  assert.equal(seen[3].searchParams.get('countryCode'), 'US');
});

test('empty/short place inputs never contact providers; unknown cities return an empty result', async () => {
  let calls = 0;
  const { places } = harness(async () => { calls++; return Response.json({}); });
  for (const query of ['', '?q=a', '?q=%20', '?q=%2CJapan']) assert.equal((await places(request('/api/places' + query))).status, 400);
  assert.equal(calls, 0);
  const result = await places(request('/api/places?q=Unfindable'));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { places: [] });
});

test('localized region names preserve country-matching cities while exact regions rank first', () => {
  const { weather } = harness(() => {});
  const japaneseTokyo = weather.normalizePlaces([
    place(1, '東京', '日本', 'JP', 35.68, 139.69, '東京都'),
    place(2, 'Tokyo', 'United States', 'US', 40, -90, 'Texas'),
  ], 'Tokyo, Tokyo, Japan');
  assert.equal(japaneseTokyo.length, 1);
  assert.equal(japaneseTokyo[0].id, '1');
  assert.equal(japaneseTokyo[0].countryCode, 'JP');
  assert.equal(japaneseTokyo[0].label, '東京, 東京都, 日本');
  const paris = weather.normalizePlaces([
    place(3, 'Paris', 'United States', 'US', 36.3, -88.3, 'Tennessee'),
    place(4, 'Paris', 'France', 'FR', 48.85, 2.35, 'Île-de-France'),
    place(5, 'Paris', 'United States', 'US', 33.66, -95.55, 'Texas'),
  ], 'Paris, Texas, US');
  assert.deepEqual(paris.map(place => place.id), ['5', '3']);
  assert.equal(paris.every(place => place.countryCode === 'US'), true);
});

test('provider failure retries once and returns recoverable errors instead of stale Osaka weather', async () => {
  let calls = 0;
  const { forecast, places } = harness(async () => { calls++; return Response.json({ error: true }, { status: 503 }); });
  assert.equal((await forecast(request('/api/weather?lat=48.85&lon=2.35'))).status, 502);
  assert.equal(calls, 2);
  assert.equal((await places(request('/api/places?q=Paris'))).status, 502);
  assert.equal(calls, 4);
});

test('malformed provider arrays are rejected rather than rendering invented values', async () => {
  const malformed = forecastData(); malformed.daily.temperature_2m_max = [];
  const { forecast } = harness(async () => Response.json(malformed));
  assert.equal((await forecast(request('/api/weather?lat=0&lon=0'))).status, 502);
});

test('stalled provider requests are aborted on both bounded attempts', async () => {
  let calls = 0, deadlines = 0;
  const { forecast } = harness(async (url, options) => {
    calls++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }));
  }, { setTimeout(callback, duration) { assert.equal(duration, 7000); deadlines++; queueMicrotask(callback); return 1; }, clearTimeout() {} });
  assert.equal((await forecast(request('/api/weather?lat=0&lon=0'))).status, 502);
  assert.equal(calls, 2); assert.equal(deadlines, 2);
});
