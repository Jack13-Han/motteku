const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(relative, stubs = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    if (name in stubs) return stubs[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', stubs);
    if (name.startsWith('.')) return load(path.join(path.dirname(relative), name) + '.ts', stubs);
    return require(name);
  });
  return exports;
}
const helpers = load('lib/dashboard.ts');
const trip = { id: 'trip-1', name: 'My Sapporo trip', type: 'Camping', location: 'Sapporo, Japan', startDate: '2026-12-01', endDate: '2026-12-03', budget: 12345, activities: [] };
const daily = { time: ['2026-12-01'], weather_code: [71], temperature_2m_max: [3], temperature_2m_min: [-2], precipitation_probability_max: [60] };
const forecast = { latitude: 43.06, longitude: 141.35, timezone: 'Asia/Tokyo', daily, selection: { daily, coverage: 'trip' } };
const place = { id: 'sapporo', name: 'Sapporo', label: 'Sapporo, Japan', latitude: 43.06, longitude: 141.35 };

test('progress uses real counts, bounds invalid counts and handles empty lists', () => {
  assert.equal(helpers.packingProgress(3, 8), 38);
  for (const [packed, total, expected] of [[0, 0, 0], [4, 2, 100], [-1, 2, 0], [NaN, 3, 0], [1, Infinity, 0]]) assert.equal(helpers.packingProgress(packed, total), expected);
});

test('departure uses calendar dates and distinguishes future, departure day, active and past trips', () => {
  assert.deepEqual(helpers.departureStatus(trip.startDate, trip.endDate, new Date(2026, 10, 28, 23)), { key: '{days} days left', days: 3 });
  assert.equal(helpers.departureStatus(trip.startDate, trip.endDate, new Date(2026, 11, 1)).key, 'Departure today!');
  assert.equal(helpers.departureStatus(trip.startDate, trip.endDate, new Date(2026, 11, 2)).key, 'Your adventure is underway!');
  assert.equal(helpers.departureStatus(trip.startDate, trip.endDate, new Date(2026, 11, 4)).key, 'Memories made. Where next?');
  assert.equal(helpers.departureStatus('2026-02-30', trip.endDate).key, 'Dates to be confirmed');
});

test('weather lookup sends the actual destination, chosen coordinates, trip dates and language', async () => {
  const calls = [], controller = new AbortController();
  const result = await helpers.loadDashboardWeather(trip, 'ja', controller.signal, async (url, options) => {
    calls.push(new URL(url, 'https://local.example'));
    assert.equal(options.signal, controller.signal);
    return Response.json(calls.length === 1 ? { places: [place] } : forecast);
  });
  assert.equal(calls[0].searchParams.get('q'), 'Sapporo, Japan');
  assert.equal(calls[1].searchParams.get('lat'), '43.06');
  assert.equal(calls[1].searchParams.get('lon'), '141.35');
  assert.equal(calls[1].searchParams.get('startDate'), '2026-12-01');
  assert.equal(calls[1].searchParams.get('endDate'), '2026-12-03');
  assert.equal(calls[1].searchParams.get('language'), 'ja');
  assert.equal(result.forecast.selection.daily.temperature_2m_max[0], 3);
});

test('aborted destination requests cannot start the forecast request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(helpers.loadDashboardWeather(trip, 'en', controller.signal, async () => { calls++; controller.abort(); return Response.json({ places: [place] }); }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('weather failures, no destination match and malformed forecast never become invented weather', async () => {
  for (const fetcher of [async () => Response.json({}, { status: 503 }), async () => Response.json({ places: [] }), async url => Response.json(url.startsWith('/api/places') ? { places: [place] } : { selection: { daily: {}, coverage: 'trip' } })]) {
    await assert.rejects(helpers.loadDashboardWeather(trip, 'en', new AbortController().signal, fetcher));
  }
});

function render(weather) {
  const navigated = [], deleted = [];
  const jsx = (type, props) => ({ type, props });
  const t = (key, params = {}) => key.replace(/\{([^}]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  const component = load('components/TravelDashboard.tsx', {
    react: { useEffect: () => {}, useState: initial => [weather || initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/lib/i18n': { useLanguage: () => ({ language: 'en', t, date: value => value }) },
  }).default;
  const tree = component({ trip, packed: 3, total: 8, spent: 2345, onNavigate: tab => navigated.push(tab), onDeleteTrip: () => deleted.push(true) });
  const nodes = [];
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object') { nodes.push(node); visit(node.props?.children); } }
  visit(tree);
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : node == null ? '' : String(node);
  return { tree, nodes, text: text(tree), navigated, deleted, textOf: text };
}

test('dashboard renders real trip name, calculated progress and budget instead of reference sample values', () => {
  const output = render();
  assert.match(output.text, /My Sapporo trip/);
  assert.match(output.text, /38\s*%/);
  assert.match(output.text, /12,345/);
  assert.match(output.text, /2,345/);
  assert.match(output.text, /3 \/ 8 items/);
  assert.doesNotMatch(output.text, /Osaka Camping Weekend|70%|22°C/);
});

test('quick actions and summary cards open their real tabs and delete remains available', () => {
  const output = render();
  const quick = output.nodes.filter(node => node.type === 'button' && node.props.className?.startsWith('travel-quick-action'));
  quick.forEach(node => node.props.onClick());
  assert.deepEqual(output.navigated, ['Itinerary', 'Packing list', 'Budget', 'Weather & AI']);
  output.nodes.find(node => node.props.className === 'travel-hero-delete').props.onClick();
  assert.equal(output.deleted.length, 1);
  const cards = output.nodes.filter(node => node.type === 'button' && node.props.className?.startsWith('travel-summary-card'));
  cards.forEach(node => node.props.onClick());
  assert.deepEqual(output.navigated.slice(4), ['Packing list', 'Budget', 'Weather & AI']);
});

test('old trip weather is hidden immediately when destination or language changes', () => {
  const old = { key: helpers.dashboardWeatherKey({ ...trip, id: 'old-trip' }, 'en'), status: 'ready', place, forecast };
  assert.match(render(old).text, /Loading forecast…/);
  assert.doesNotMatch(render(old).text, /3°C|Snow/);
  assert.notEqual(helpers.dashboardWeatherKey(trip, 'en'), helpers.dashboardWeatherKey(trip, 'ja'));
});

test('weather preview is explicitly labelled with the available day rather than advertised as trip weather', () => {
  const output = render({ key: helpers.dashboardWeatherKey(trip, 'en'), status: 'ready', place, forecast: { ...forecast, selection: { daily, coverage: 'preview' } } });
  assert.match(output.text, /3°C/);
  assert.match(output.text, /Upcoming weather/);
  assert.doesNotMatch(output.text, /Trip forecast/);
});
