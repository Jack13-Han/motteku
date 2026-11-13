const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, resolve = require) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', source)(exports, resolve);
  return exports;
}
const api = load('lib/advice.ts');
const { normalizeAdviceInput, builtInAdvice, parseAdviceResult, generateAdvice } = api;
const input = (overrides = {}) => normalizeAdviceInput({ language: 'en', trip: { name: 'Friends camping', type: 'Camping', location: 'Tokyo, Japan', startDate: '2026-11-06', endDate: '2026-11-08', people: 3 }, weather: null, items: [], ...overrides });
const weather = { time: ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09'], temperature_2m_max: [20, 29, 19, 18], temperature_2m_min: [11, 8, 0, 9], precipitation_probability_max: [0, 70, 0, 0], weather_code: [0, 95, 0, 0] };
const result = { advice: 'Review waterproof layers and the group equipment before departure.', suggestedItems: ['Rain jacket', 'Waterproof bag'], cautions: ['Review the latest forecast.'] };
const providerResult = value => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 });

test('only forecast dates overlapping the trip reach advice, including partial coverage', () => {
  const normalized = input({ weather });
  assert.deepEqual(normalized.weather.time, ['2026-11-06', '2026-11-07']);
  assert.deepEqual(normalized.weather.temperature_2m_min, [8, 0]);
  assert.equal(input({ trip: { ...normalized.trip, startDate: '2027-01-01', endDate: '2027-01-02' }, weather }).weather, null);
  assert.equal(input({ trip: { ...normalized.trip, startDate: '', endDate: '' }, weather }).weather, null);
});

test('malformed dates, member counts, weather arrays and oversized names are rejected', () => {
  const baseline = input();
  for (const value of [null, {}, { ...baseline, language: 'fr' }, { ...baseline, trip: { ...baseline.trip, people: 0 } }, { ...baseline, trip: { ...baseline.trip, startDate: '2026-02-30' } }, { ...baseline, weather: { ...weather, temperature_2m_min: [] } }, { ...baseline, items: [{ name: 'a'.repeat(201) }] }, { ...baseline, items: [{ name: 'Tent', quantity: Infinity }] }]) {
    assert.throws(() => normalizeAdviceInput(value), /Check your input/);
  }
});

test('built-in advice works without forecast and does not invent rain or cold conditions', () => {
  const advice = builtInAdvice(input({ items: [{ name: 'Headlamp' }, { name: '水筒' }] }));
  assert.ok(advice.advice.includes('Tokyo, Japan'));
  assert.ok(advice.advice.includes('3 people'));
  assert.ok(advice.suggestedItems.includes('Sleeping bag'));
  assert.ok(!advice.suggestedItems.includes('Headlamp'));
  assert.ok(!advice.suggestedItems.includes('Water bottle'));
  assert.ok(!advice.suggestedItems.includes('Umbrella'));
  assert.ok(!advice.suggestedItems.includes('Warm layer'));
  assert.ok(advice.cautions.some(text => text.includes('No weather conditions have been assumed')));
});

test('Japanese fallback uses supplied rain/cold/hot forecast and excludes existing translated items', () => {
  const advice = builtInAdvice(input({ language: 'ja', weather, items: [{ name: 'レインジャケット' }] }));
  assert.ok(advice.advice.includes('Tokyo, Japan'));
  assert.ok(advice.advice.includes('3人'));
  assert.ok(advice.suggestedItems.includes('傘'));
  assert.ok(advice.suggestedItems.includes('防寒着'));
  assert.ok(advice.suggestedItems.includes('帽子'));
  assert.ok(advice.suggestedItems.includes('手袋'));
  assert.ok(!advice.suggestedItems.includes('レインジャケット'));
  assert.ok(advice.cautions.some(text => text.includes('雷雨')));
});

test('no-key fallback makes no provider call and returns usable typed advice', async () => {
  const response = await generateAdvice(input(), { fetcher: () => { throw new Error('Must not fetch'); } });
  assert.equal(response.configured, false);
  assert.equal(response.source, 'built-in');
  assert.equal(response.reason, 'not-configured');
  assert.ok(response.result.suggestedItems.length);
});

test('valid Gemini result is filtered against existing items and API key stays out of URLs', async () => {
  let calls = 0;
  const response = await generateAdvice(input({ items: [{ name: 'レインジャケット' }] }), { apiKey: 'test-private-key', fetcher: async (url, options) => {
    calls++;
    assert.ok(!url.includes('test-private-key'));
    assert.equal(options.headers['x-goog-api-key'], 'test-private-key');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.contents[0].parts[0].text.includes('"weather":null'));
    return providerResult(result);
  } });
  assert.equal(calls, 1);
  assert.equal(response.source, 'gemini');
  assert.deepEqual(response.result.suggestedItems, ['Waterproof bag']);
});

test('retired configured model and busy service retry once using the supported replacement', async () => {
  for (const status of [404, 503]) {
    const models = [];
    const response = await generateAdvice(input(), { apiKey: 'test-key', model: 'gemini-2.5-flash', fetcher: async url => {
      models.push(url);
      return models.length === 1 ? new Response(JSON.stringify({ error: { message: 'Model unavailable' } }), { status }) : providerResult(result);
    } });
    assert.equal(response.source, 'gemini');
    assert.equal(models.length, 2);
    assert.ok(models[0].includes('gemini-2.5-flash:'));
    assert.ok(models[1].includes('gemini-3.5-flash-lite:'));
  }
});

test('quota, network and malformed provider results return usable fallback without repeated paid calls', async () => {
  for (const fetcher of [
    async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }),
    async () => { throw new Error('network'); },
    async () => providerResult({ advice: '', suggestedItems: [], cautions: [] }),
    async () => providerResult({ advice: 'Long enough advice', suggestedItems: null, cautions: [] }),
    async () => new Response('Not JSON', { status: 200 }),
  ]) {
    let calls = 0;
    const response = await generateAdvice(input(), { apiKey: 'test-key', fetcher: (...args) => { calls++; return fetcher(...args); } });
    assert.equal(calls, 1);
    assert.equal(response.configured, true);
    assert.equal(response.source, 'built-in');
    assert.equal(response.reason, 'unavailable');
    assert.ok(response.result.suggestedItems.length);
  }
});

test('request deadline aborts a slow provider and returns fallback', async () => {
  const started = Date.now();
  const response = await generateAdvice(input(), { apiKey: 'test-key', timeoutMs: 20, fetcher: (url, options) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => resolve(providerResult(result)), 2000);
    options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
  }) });
  assert.equal(response.source, 'built-in');
  assert.ok(Date.now() - started < 1000);
});

test('result schema rejects empty output and keeps every suggestion a safe string', () => {
  assert.equal(parseAdviceResult({ advice: 'x', suggestedItems: [], cautions: [] }, input()), null);
  assert.equal(parseAdviceResult({ ...result, suggestedItems: [{ name: 'Tent' }] }, input()), null);
  assert.deepEqual(parseAdviceResult({ ...result, suggestedItems: ['Rain jacket', ' Rain jacket ', 'Waterproof bag'] }, input()).suggestedItems, ['Rain jacket', 'Waterproof bag']);
});

test('actual route returns 400 for bad JSON/oversized input and 200 fallback with no key', async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const { POST } = load('app/api/advice/route.ts', name => name === '@/lib/advice' ? api : name === 'next/server' ? { NextResponse: { json: (value, init) => Response.json(value, init) } } : require(name));
  try {
    assert.equal((await POST(new Request('http://localhost/api/advice', { method: 'POST', body: '{' }))).status, 400);
    assert.equal((await POST(new Request('http://localhost/api/advice', { method: 'POST', body: 'a'.repeat(100001) }))).status, 400);
    const response = await POST(new Request('http://localhost/api/advice', { method: 'POST', body: JSON.stringify(input()) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'built-in');
    assert.ok(body.result.advice.length > 0);
  } finally { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; }
});
