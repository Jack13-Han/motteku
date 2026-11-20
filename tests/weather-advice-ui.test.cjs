const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the real client component and its event handlers. Only React scheduling,
// translation and the transport are replaced; no production APIs are contacted.
const filename = path.resolve(__dirname, '../components/WeatherAdvice.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const pending = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const osaka = { id: 'osaka', name: 'Osaka', label: 'Osaka, Japan', latitude: 34.69, longitude: 135.5, country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };
const tokyo = { ...osaka, id: 'tokyo', name: 'Tokyo', label: 'Tokyo, Japan', latitude: 35.68, longitude: 139.76 };
const paris = { id: 'paris', name: 'Paris', label: 'Paris, France', latitude: 48.85, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' };
const trip = { id: 'trip-1', name: 'Test trip', type: 'Camping', location: 'Osaka, Japan', startDate: '2026-11-07', endDate: '2026-11-08', people: 3 };
const day = (date = '2026-11-07', max = 23) => ({ time: [date], weather_code: [0], temperature_2m_max: [max], temperature_2m_min: [11], precipitation_probability_max: [10] });
const forecast = (place, max = 23, coverage = 'trip') => {
  const daily = day('2026-11-07', max);
  return { latitude: place.latitude, longitude: place.longitude, timezone: place.timezone, daily, selection: { daily, adviceDaily: coverage === 'preview' ? null : daily, coverage, availableStartDate: '2026-11-06', availableEndDate: '2026-11-21' } };
};
const advice = (source = 'gemini', text = 'CURRENT_ADVICE') => ({ source, reason: source === 'built-in' ? 'unavailable' : undefined, result: { advice: text, suggestedItems: ['Rain jacket', 'Map', 'Water'], cautions: ['Check before departure.'] } });

function harness(overrides = {}) {
  let props = { trip: { ...trip }, items: [{ name: 'Water' }], canAddItems: true, ...overrides };
  let language = 'en', index = 0, dirty = false, tree, timerId = 0;
  const slots = [], effects = [], requests = [], timers = new Map(), destinations = [], added = [];
  props.onDestinationChange ||= label => destinations.push(label);
  props.onAddItem ||= async (name, type) => { added.push({ name, type }); return true; };
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; dirty = true; }];
    },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect(effect, deps) {
      const slot = index++, old = slots[slot];
      if (!old || deps.some((value, position) => !Object.is(value, old.deps[position]))) {
        effects.push(() => { old?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module, AbortController, URLSearchParams,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options = {}) {
      const request = { url: new URL(url, 'http://motteku.test'), options, result: pending() };
      requests.push(request);
      // Intentionally ignore AbortSignal here. Returning cancelled responses late
      // verifies the actual component's stale-response guard, not the mock's.
      return request.result.promise;
    },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => String(key) });
      if (name === '@/lib/i18n') return { useLanguage: () => ({ language, t: (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)), date: value => value }) };
      throw new Error('Unexpected component import: ' + name);
    },
  }, { filename });
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    if (typeof node !== 'object') return [node];
    return [node, ...nodes(node.props.children)];
  }
  const textOf = node => nodes(node).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
  function render() {
    let turns = 0;
    do {
      if (++turns > 25) throw new Error('Unexpected component render loop');
      dirty = false; index = 0; tree = module.exports.default(props);
      while (effects.length) effects.shift()();
    } while (dirty);
  }
  function find(predicate) { const result = nodes().find(node => typeof node === 'object' && predicate(node)); assert.ok(result, 'Expected component control was not found'); return result; }
  const button = text => find(node => node.type === 'button' && textOf(node).includes(text));
  function click(text) { const node = button(text); assert.notEqual(node.props.disabled, true, 'Cannot click a disabled control: ' + text); node.props.onClick?.(); render(); }
  function input(value) { find(node => node.type === 'input').props.onChange({ target: { value } }); render(); }
  function search(value) { input(value); find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); }
  const latest = route => { const list = requests.filter(request => request.url.pathname === route); assert.ok(list.length, 'No request for ' + route); return list.at(-1); };
  async function flush() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); render(); } }
  async function respond(request, body, status = 200) { request.result.resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); await flush(); }
  async function boot(place = osaka, response = forecast(place)) { await respond(latest('/api/places'), { places: [place] }); await respond(latest('/api/weather'), response); }
  render();
  return {
    requests, added, destinations, timers, nodes, find, button, click, input, search, latest, flush, respond, boot,
    text: () => textOf(tree),
    forecastText: () => nodes().filter(node => typeof node === 'object' && node.props.className === 'forecast-day').map(textOf).join(' '),
    setProps(next) { props = { ...props, ...next }; render(); },
    setLanguage(next) { language = next; render(); },
    selectType(value) { find(node => node.type === 'select').props.onChange({ target: { value } }); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('Tokyo and Paris selection requests their own coordinates rather than the default city', async () => {
  const h = harness();
  h.search('Tokyo');
  const tokyoSearch = h.latest('/api/places');
  assert.equal(tokyoSearch.url.searchParams.get('q'), 'Tokyo');
  await h.respond(tokyoSearch, { places: [tokyo, { ...tokyo, id: 'other-tokyo', label: 'Tokyo, another region', latitude: 1, longitude: 2 }] });
  assert.equal(h.requests.filter(request => request.url.pathname === '/api/weather').length, 0, 'Ambiguous manual searches require an explicit place choice');
  h.click('Tokyo, Japan');
  const tokyoWeather = h.latest('/api/weather');
  assert.equal(tokyoWeather.url.searchParams.get('lat'), String(tokyo.latitude));
  assert.equal(tokyoWeather.url.searchParams.get('lon'), String(tokyo.longitude));
  await h.respond(tokyoWeather, forecast(tokyo, 27));
  assert.ok(h.forecastText().includes('27'));
  h.search('Paris, France');
  await h.respond(h.latest('/api/places'), { places: [paris] });
  const parisWeather = h.latest('/api/weather');
  assert.equal(parisWeather.url.searchParams.get('lat'), String(paris.latitude));
  assert.equal(parisWeather.url.searchParams.get('lon'), String(paris.longitude));
  await h.respond(parisWeather, forecast(paris, 14));
  assert.ok(h.forecastText().includes('14'));
  assert.equal(h.forecastText().includes('27'), false);
  assert.deepEqual(h.destinations, ['Tokyo, Japan', 'Paris, France'], 'A sole result selected by an explicit search must also update the parent destination');
  h.unmount();
});

test('editing the search clears displayed weather and advice immediately', async () => {
  const h = harness(); await h.boot();
  h.click('Generate suggestions'); await h.respond(h.latest('/api/advice'), advice('gemini', 'OLD_ADVICE'));
  assert.ok(h.text().includes('OLD_ADVICE')); assert.ok(h.forecastText());
  h.input('Paris');
  assert.equal(h.forecastText(), '');
  assert.equal(h.text().includes('OLD_ADVICE'), false);
  assert.equal(h.button('Generate suggestions').props.disabled, true);
  assert.equal(h.text().includes('Osaka, Japan'), false);
  h.unmount();
});

test('late aborted place, forecast and advice responses cannot overwrite a later destination', async () => {
  const h = harness();
  h.search('Tokyo'); const oldSearch = h.latest('/api/places');
  h.search('Paris'); const newSearch = h.latest('/api/places');
  assert.equal(oldSearch.options.signal.aborted, true);
  await h.respond(newSearch, { places: [paris] });
  const oldWeather = h.latest('/api/weather');
  await h.respond(oldSearch, { places: [tokyo] });
  assert.equal(h.text().includes('Tokyo, Japan'), false);
  h.search('Tokyo'); await h.respond(h.latest('/api/places'), { places: [tokyo] });
  const newWeather = h.latest('/api/weather');
  assert.equal(oldWeather.options.signal.aborted, true);
  await h.respond(newWeather, forecast(tokyo, 28));
  await h.respond(oldWeather, forecast(paris, -12));
  assert.ok(h.forecastText().includes('28'));
  assert.equal(h.forecastText().includes('-12'), false);
  h.click('Generate suggestions'); const oldAdvice = h.latest('/api/advice');
  h.search('Paris'); await h.respond(h.latest('/api/places'), { places: [paris] });
  await h.respond(h.latest('/api/weather'), forecast(paris, 13));
  await h.respond(oldAdvice, advice('gemini', 'CANCELLED_TOKYO_ADVICE'));
  assert.equal(oldAdvice.options.signal.aborted, true);
  assert.equal(h.text().includes('CANCELLED_TOKYO_ADVICE'), false);
  assert.ok(h.forecastText().includes('13'));
  h.unmount();
});

test('advice uses the selected location, only trip-date weather, and current deduplicated packing items', async () => {
  const h = harness({ items: [{ name: 'Water', type: 'personal', quantity: 1 }, { name: ' water ', type: 'personal', quantity: 2 }, { name: 'Tent', type: 'shared', quantity: 1 }] });
  const response = forecast(paris);
  response.daily = { time: ['2026-11-06', '2026-11-07'], weather_code: [61, 0], temperature_2m_max: [40, 23], temperature_2m_min: [30, 11], precipitation_probability_max: [100, 10] };
  await h.boot(paris, response);
  h.click('Generate suggestions');
  const request = h.latest('/api/advice'), body = JSON.parse(request.options.body);
  assert.equal(body.trip.location, paris.label);
  assert.equal(body.language, 'en');
  assert.deepEqual(body.weather.time, ['2026-11-07']);
  assert.deepEqual(body.weather.temperature_2m_max, [23]);
  assert.equal(body.items.length, 2);
  assert.equal(body.items.find(item => item.type === 'personal').quantity, 2);
  assert.equal(body.items.find(item => item.type === 'shared').name, 'Tent');
  h.unmount();
});

test('preview weather is excluded from advice and built-in fallback is labeled honestly', async () => {
  const h = harness(); await h.boot(osaka, forecast(osaka, 25, 'preview'));
  assert.ok(h.text().includes('Trip forecast is not available.'));
  h.click('Generate suggestions');
  assert.equal(JSON.parse(h.latest('/api/advice').options.body).weather, null);
  await h.respond(h.latest('/api/advice'), advice('built-in'));
  assert.ok(h.text().includes('Built-in suggestions'));
  assert.ok(h.text().includes('generated without AI'));
  assert.equal(h.text().includes('Gemini AI suggestions'), false);
  h.unmount();
});

test('suggestion buttons call the real personal/shared add callback and block duplicates or read-only additions', async () => {
  const h = harness(); await h.boot();
  h.click('Generate suggestions'); await h.respond(h.latest('/api/advice'), advice());
  assert.equal(h.button('Water').props.disabled, true);
  h.click('Rain jacket'); await h.flush();
  h.selectType('shared'); h.click('Map'); await h.flush();
  assert.deepEqual(h.added, [{ name: 'Rain jacket', type: 'personal' }, { name: 'Map', type: 'shared' }]);
  h.setProps({ canAddItems: false });
  assert.equal(h.button('Rain jacket').props.disabled, true);
  assert.ok(h.text().includes('Only the organizer or an admin can add suggested items.'));
  h.unmount();
});

test('language and trip switches invalidate advice and request fresh matching forecast data', async () => {
  const h = harness(); await h.boot();
  h.click('Generate suggestions'); await h.respond(h.latest('/api/advice'), advice('gemini', 'ENGLISH_OLD_ADVICE'));
  h.setLanguage('ja');
  const languageWeather = h.latest('/api/weather');
  assert.equal(languageWeather.url.searchParams.get('language'), 'ja');
  assert.equal(h.text().includes('ENGLISH_OLD_ADVICE'), false);
  await h.respond(languageWeather, forecast(osaka));
  h.click('Generate suggestions');
  assert.equal(JSON.parse(h.latest('/api/advice').options.body).language, 'ja');
  const previousAdvice = h.latest('/api/advice');
  h.setProps({ trip: { ...trip, id: 'trip-2', location: 'Paris, France', startDate: '2026-11-10', endDate: '2026-11-12' } });
  assert.equal(previousAdvice.options.signal.aborted, true);
  assert.equal(h.find(node => node.type === 'input').props.value, 'Paris, France');
  assert.equal(h.forecastText(), '');
  assert.equal(h.latest('/api/places').url.searchParams.get('q'), 'Paris, France');
  await h.respond(h.latest('/api/places'), { places: [paris] });
  const tripWeather = h.latest('/api/weather');
  assert.equal(tripWeather.url.searchParams.get('lat'), String(paris.latitude));
  assert.equal(tripWeather.url.searchParams.get('startDate'), '2026-11-10');
  await h.respond(previousAdvice, advice('gemini', 'OLD_TRIP_ADVICE'));
  assert.equal(h.text().includes('OLD_TRIP_ADVICE'), false);
  h.unmount();
});

test('a delayed parent destination update does not cancel the newly selected forecast request', async () => {
  let delayedDestination;
  const h = harness({ onDestinationChange: label => { delayedDestination = label; } });
  await h.boot();
  h.search('Tokyo');
  await h.respond(h.latest('/api/places'), { places: [tokyo, { ...tokyo, id: 'tokyo-other', label: 'Tokyo, another region' }] });
  h.click('Tokyo, Japan');
  assert.equal(delayedDestination, tokyo.label);
  const request = h.latest('/api/weather');
  const searchCount = h.requests.filter(request => request.url.pathname === '/api/places').length;
  assert.equal(request.options.signal.aborted, false);
  h.setProps({ trip: { ...trip, location: delayedDestination } });
  assert.equal(request.options.signal.aborted, false, 'Acknowledging our selected place must not cancel its in-flight forecast');
  assert.equal(h.requests.filter(request => request.url.pathname === '/api/places').length, searchCount, 'Parent acknowledgement must not search again');
  await h.respond(request, forecast(tokyo, 29));
  assert.ok(h.forecastText().includes('29'));
  assert.equal(h.button('Generate suggestions').props.disabled, false);
  h.unmount();
});

test('a pending own destination label cannot skip initialization for a different trip with that label', async () => {
  const h = harness(); await h.boot();
  h.search('Tokyo');
  await h.respond(h.latest('/api/places'), { places: [tokyo, { ...tokyo, id: 'tokyo-other', label: 'Tokyo, another region' }] });
  h.click('Tokyo, Japan');
  const previousForecast = h.latest('/api/weather');
  const searchesBefore = h.requests.filter(request => request.url.pathname === '/api/places').length;
  h.setProps({ trip: { ...trip, id: 'trip-2', location: tokyo.label } });
  assert.equal(previousForecast.options.signal.aborted, true);
  assert.equal(h.requests.filter(request => request.url.pathname === '/api/places').length, searchesBefore + 1);
  assert.equal(h.latest('/api/places').url.searchParams.get('q'), tokyo.label);
  await h.respond(h.latest('/api/places'), { places: [tokyo] });
  const currentForecast = h.latest('/api/weather');
  assert.notEqual(currentForecast, previousForecast);
  assert.equal(currentForecast.options.signal.aborted, false);
  await h.respond(previousForecast, forecast(tokyo, -99));
  assert.equal(h.forecastText(), '');
  await h.respond(currentForecast, forecast(tokyo, 26));
  assert.ok(h.forecastText().includes('26'));
  h.unmount();
});
