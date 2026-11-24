const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(relative, stubs = {}, globals = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const exports = {};
  cache.set(relative, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const requireLocal = name => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', stubs, globals, cache);
    if (name.startsWith('.')) return load(path.join(path.dirname(relative), name) + '.ts', stubs, globals, cache);
    return require(name);
  };
  new Function('exports', 'require', 'Date', 'window', 'Notification', 'localStorage', 'document', 'clearInterval', code)(exports, requireLocal, globals.Date || Date, globals.window, globals.Notification, globals.localStorage, globals.document, globals.window?.clearInterval || clearInterval);
  return exports;
}
const helper = load('lib/reminders.ts');
const textOf = node => Array.isArray(node) ? node.map(textOf).join(' ') : node && typeof node === 'object' ? textOf(node.props?.children) : node == null ? '' : String(node);
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));

function harness(file, initialProps, options = {}) {
  const clock = { time: options.time ?? new Date(2026, 10, 20, 9).getTime() };
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.time])); } static now() { return clock.time; } }
  const intervals = new Map(), sent = [], storage = new Map(), slots = [], effects = [];
  let nextTimer = 0, cursor = 0, pending = [], props = initialProps, tree;
  const win = { setInterval(fn, ms) { const id = ++nextTimer; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } };
  class BrowserNotification {
    static permission = options.permission || 'default';
    static async requestPermission() { if (options.rejectPermission) throw Error('Browser request failed'); return options.result || 'denied'; }
    constructor(title, details) { sent.push({ title, ...details }); }
  }
  if (!options.unsupported) win.Notification = BrowserNotification;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++; const old = effects[i]; if (!old || !deps || deps.some((value, n) => value !== old.deps?.[n])) pending.push({ i, fn, deps }); },
  };
  const jsx = (type, props) => ({ type, props });
  const component = load(file, { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, 'lucide-react': new Proxy({}, { get: (_, key) => key }), '@/lib/useTravelCheckReminders': { useTravelCheckReminders: () => [] }, '@/lib/i18n': { useLanguage: () => ({ t, date: value => value }) } }, { Date: TestDate, window: win, Notification: BrowserNotification, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, document: { addEventListener() {}, removeEventListener() {} } }).default;
  function render(next = props) {
    props = next; cursor = 0; pending = [];
    tree = component(props);
    for (const effect of pending) { effects[effect.i]?.cleanup?.(); effects[effect.i] = { deps: effect.deps, cleanup: effect.fn() }; }
    return textOf(tree);
  }
  function nodes() { const all = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object') { all.push(node); visit(node.props?.children); } }; visit(tree); return all; }
  render();
  return { render, nodes, text: () => textOf(tree), sent, storage, intervals, advance(time) { clock.time = time; for (const timer of [...intervals.values()]) timer.fn(); return render(); }, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}

test('trip reminders reject missing/impossible dates and fall back from invalid preparation dates', () => {
  for (const value of ['', '2026-02-30', '2026-13-01', 'not-a-date']) assert.deepEqual(helper.tripReminders(value, '2026-11-20'), []);
  for (const value of ['', '2026-02-30', '2026-12-31']) assert.equal(helper.tripReminders('2026-11-24', value).find(item => item.id === 'prep').date, '2026-11-24');
  assert.deepEqual(helper.tripReminders('2026-03-01', '2026-02-27').map(item => item.date), ['2026-02-27', '2026-02-28', '2026-03-01']);
  assert.equal(helper.tripReminders('2028-03-01')[0].date, '2028-02-29');
});

test('reminder preview changes immediately with trip props and never shows a phantom date', () => {
  let opened = 0;
  const props = { tripName: 'Sapporo', startDate: '2026-11-24', prepStartDate: '2026-11-21', onOpen: () => opened++ };
  const ui = harness('components/ReminderPeek.tsx', props);
  assert.match(ui.text(), /Preparation starts.*2026-11-21/);
  ui.nodes().find(node => node.type === 'button').props.onClick(); assert.equal(opened, 1);
  for (const startDate of ['', '2026-02-30']) {
    ui.render({ ...props, tripName: 'Shared group', startDate });
    assert.match(ui.text(), /Travel dates are needed before reminders can be scheduled/);
    assert.doesNotMatch(ui.text(), /Day before departure|NaN|Sapporo/);
  }
  ui.unmount();
});

test('preview ticks across midnight and removes its interval on unmount', () => {
  const ui = harness('components/ReminderPeek.tsx', { tripName: 'Weekend', startDate: '2026-11-21', prepStartDate: '2026-11-20', onOpen() {} }, { time: new Date(2026, 10, 20, 23, 59).getTime() });
  assert.match(ui.text(), /Preparation starts/);
  assert.equal(ui.intervals.size, 1);
  assert.equal([...ui.intervals.values()][0].ms, 60000);
  assert.match(ui.advance(new Date(2026, 10, 21, 0, 1).getTime()), /Trip departure/);
  assert.doesNotMatch(ui.text(), /Preparation starts|Day before departure/);
  assert.match(ui.advance(new Date(2026, 10, 22, 0, 1).getTime()), /No upcoming reminders/);
  ui.unmount(); assert.equal(ui.intervals.size, 0);
});

test('browser reminders fire once per account on the due day, ignore invalid trips, and stop after that date', () => {
  const trips = [{ id: 'same-trip', name: 'Departure', startDate: '2026-11-20', prepStartDate: '2026-11-19', items: [] }, { id: 'bad', name: 'Shared group', startDate: '', items: [] }, { id: 'later', name: 'Later', startDate: '2026-11-24', prepStartDate: '2026-11-21', items: [] }];
  const props = { trips, accountId: 'account-A', onOpen() {} };
  const ui = harness('components/NotificationCenter.tsx', props, { permission: 'granted' });
  assert.equal(ui.sent.length, 1); assert.equal(ui.sent[0].title, 'Trip departure: Departure');
  ui.advance(new Date(2026, 10, 20, 9, 1).getTime()); assert.equal(ui.sent.length, 1);
  ui.render({ ...props, accountId: 'account-B' }); assert.equal(ui.sent.length, 2);
  assert.notEqual(ui.sent[0].tag, ui.sent[1].tag);
  ui.advance(new Date(2026, 10, 21, 9).getTime()); assert.equal(ui.sent.length, 3);
  assert.equal(ui.sent[2].title, 'Preparation starts: Later');
  ui.unmount(); assert.equal(ui.intervals.size, 0);
});

test('notifications remain silent without browser permission and an undated trip has clear disabled schedule controls', () => {
  const center = harness('components/NotificationCenter.tsx', { trips: [{ id: 'today', name: 'Today', startDate: '2026-11-20', items: [] }], accountId: 'A', onOpen() {} });
  assert.equal(center.sent.length, 0); center.unmount();
  const prep = harness('components/PrepReminders.tsx', { tripName: 'Shared group', startDate: '', prepStartDate: '', memberCount: 2, onPrepDate() {}, onNotice() {} });
  assert.match(prep.text(), /Travel dates are needed before reminders can be scheduled/);
  assert.doesNotMatch(prep.text(), /Day before departure|NaN/);
  assert.equal(prep.nodes().find(node => node.type === 'input' && node.props.type === 'date').props.disabled, true);
  assert.equal(prep.nodes().find(node => node.props?.className === 'prep-adjust-button').props.disabled, true);
  prep.unmount(); assert.equal(prep.intervals.size, 0);
});

test('permission decline, dismissal and request failure all return explicit feedback', async () => {
  for (const options of [{ result: 'denied' }, { result: 'default' }, { rejectPermission: true }]) {
    const notices = [];
    const ui = harness('components/PrepReminders.tsx', { tripName: 'Trip', startDate: '2026-11-24', memberCount: 2, onPrepDate() {}, onNotice: value => notices.push(value) }, options);
    await ui.nodes().find(node => node.type === 'button' && node.props.className === 'primary').props.onClick();
    assert.deepEqual(notices, ['Notification permission was not granted.']); ui.unmount();
  }
});

test('preparation editor displays the valid fallback rather than a stored date after departure', () => {
  const ui = harness('components/PrepReminders.tsx', { tripName: 'Trip', startDate: '2026-11-24', prepStartDate: '2026-12-31', memberCount: 2, onPrepDate() {}, onNotice() {} });
  assert.equal(ui.nodes().find(node => node.type === 'input' && node.props.type === 'date').props.value, '2026-11-24');
  assert.doesNotMatch(ui.text(), /2026-12-31/);
  ui.unmount();
});
