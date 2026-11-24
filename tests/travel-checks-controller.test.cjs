const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function harness(storage = new Map()) {
  const slots = [], effects = [], cache = new Map();
  let index = 0, dirty = true, uid = 'owner';
  const react = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { const next = typeof value === 'function' ? value(slots[key]) : value; if (next !== slots[key]) { slots[key] = next; dirty = true; } }]; },
    useRef(value) { const key = index++; if (!(key in slots)) slots[key] = { current: value }; return slots[key]; },
    useEffect(fn, deps) { const key = index++, old = slots[key]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); slots[key] = { deps }; effects.push(() => { slots[key].cleanup = fn(); }); } },
  };
  function load(file) {
    file = path.resolve(__dirname, '..', file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('exports', 'require', code)(exports, name => name === 'react' ? react : name === './firebase' ? { db: null } : name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name));
    return exports;
  }
  const { useTravelChecks } = load('lib/useTravelChecks.ts');
  const data = { ownerUid: 'owner', adminUids: [], bags: [{ id: 'blue', name: 'Blue bag' }], members: [{ id: 'm1', uid: 'one', name: 'Hnin' }, { id: 'm2', uid: 'two', name: 'Phyu' }], items: [{ id: 'shoes', tripId: 'trip', name: 'Shoes', type: 'personal', quantity: 1, targetMemberIds: ['m1', 'm2'] }], assignments: ['m1', 'm2'].map(memberId => ({ id: `shoes_${memberId}`, itemId: 'shoes', tripId: 'trip', memberId, status: 'packed', bagId: 'blue' })) };
  const packing = { loaded: true, cloud: false, busy: false, data };
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let current;
  async function render() {
    const previousStorage = global.localStorage, previousWindow = global.window;
    global.localStorage = localStorage; global.window = { dispatchEvent() {} };
    try {
      for (let round = 0; round < 20; round++) {
        dirty = false; index = 0;
        current = useTravelChecks('local-owner_trip', 'trip', uid, packing, { startDate: '2026-11-13', endDate: '2026-11-15' });
        while (effects.length) effects.shift()();
        await Promise.resolve(); await Promise.resolve();
        if (!dirty) return current;
      }
      throw new Error('Hook did not settle');
    } finally { global.localStorage = previousStorage; global.window = previousWindow; }
  }
  async function act(fn) {
    const previousStorage = global.localStorage, previousWindow = global.window, previousError = console.error;
    global.localStorage = localStorage; global.window = { dispatchEvent() {} }; console.error = () => {};
    try { return await fn(current); } finally { global.localStorage = previousStorage; global.window = previousWindow; console.error = previousError; await render(); }
  }
  return { render, act, storage, data, load, get current() { return current; }, async account(value) { uid = value; return render(); } };
}

test('real local controller persists snapshots, enforces bags/completion and survives refresh without departure changes', async () => {
  const app = harness(); await app.render();
  assert.deepEqual(app.current.checks, []);
  assert.equal(app.current.availableChecks[0].type, 'returnHome');
  assert.equal(app.storage.size, 0, 'merely opening a trip must not create check documents');
  const departure = JSON.stringify(app.data);
  assert.equal(await app.act(c => c.start('return-home')), true);
  assert.equal(app.current.checks[0].items.length, 2);
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m1', 'packed', '')), false);
  assert.equal(app.current.checks[0].items[0].status, 'unchecked');
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m1', 'packed', 'blue')), true);
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m2', 'missing', '')), true);
  assert.equal(await app.act(c => c.complete('return-home')), false);
  assert.equal(app.current.checks[0].status, 'inProgress');
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m2', 'usedUp', '')), true);
  assert.equal(await app.act(c => c.complete('return-home')), true);
  assert.equal(app.current.checks[0].status, 'completed');
  const refreshed = harness(app.storage); await refreshed.render();
  assert.equal(refreshed.current.checks[0].status, 'completed');
  assert.equal(refreshed.current.checks[0].items[0].currentBagId, 'blue');
  assert.equal(JSON.stringify(app.data), departure);
});

test('real controller allows only own member rows and never rewrites a frozen snapshot after source removal', async () => {
  const app = harness(); await app.render(); await app.act(c => c.start('return-home'));
  await app.account('one');
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m2', 'leaveBehind', '')), false);
  assert.equal(await app.act(c => c.updateItem('return-home', 'shoes_m1', 'leaveBehind', '')), true);
  assert.equal(await app.act(c => c.complete('return-home')), false);
  app.data.items.length = 0; app.data.assignments.length = 0;
  await app.render();
  assert.equal(app.current.checks[0].items.length, 2);
  assert.equal(app.current.checks[0].items[0].status, 'leaveBehind');
});

test('real stay-plan saves generate moving checks and retain started snapshots across later edits', async () => {
  const app = harness(); await app.render();
  const plan = { ...app.current.plan, accommodationMode: 'multiple', stays: [
    { id: 'a', name: 'Hotel A', checkOutDate: '2026-11-14', checkOutTime: '10:00', notificationMinutesBefore: 60 },
    { id: 'b', name: 'Hotel B', checkOutDate: '2026-11-15', checkOutTime: '10:00', notificationMinutesBefore: 30 },
  ] };
  assert.equal(await app.act(c => c.savePlan(plan)), true);
  assert.equal(app.current.checks.filter(c => c.type === 'transition').length, 1);
  await app.act(c => c.start('move-a'));
  const snapshot = JSON.stringify(app.current.checks.find(c => c.id === 'move-a'));
  assert.equal(await app.act(c => c.savePlan({ ...plan, accommodationMode: 'dayTrip' })), true);
  assert.equal(JSON.stringify(app.current.checks.find(c => c.id === 'move-a')), snapshot);
  assert.equal(app.current.checks.filter(c => c.type === 'returnHome').length, 1);
  const refreshed = harness(app.storage); await refreshed.render();
  assert.equal(refreshed.current.plan.accommodationMode, 'dayTrip');
});

test('completing a moving check retains its success screen instead of silently selecting the return check', async () => {
  const app = harness(); await app.render();
  const helpers = app.load('lib/travelChecks.ts');
  const plan = { ...app.current.plan, accommodationMode: 'multiple', stays: [
    { id: 'a', name: 'Hotel A', checkOutDate: '2026-11-14', checkOutTime: '10:00', notificationMinutesBefore: 60 },
    { id: 'b', name: 'Hotel B', checkOutDate: '2026-11-15', checkOutTime: '10:00', notificationMinutesBefore: 30 },
  ] };
  const checkpoints = helpers.checkpointDefinitions('trip', plan);
  checkpoints[0] = { ...checkpoints[0], status: 'inProgress', snapshotAt: 'saved', items: helpers.snapshotPackedAssignments(app.data).map(item => ({ ...item, status: 'usedUp' })) };
  let selected = '';
  const react = { useState: () => [selected, value => { selected = value; }], useRef: () => ({ current: null }), useEffect() {} };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const file = path.resolve(__dirname, '../components/ForgottenItemCheck.tsx');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/travelChecks') return helpers;
    if (name === '@/lib/i18n') return { useLanguage: () => ({ t: key => key, date: value => value, language: 'en' }) };
    if (name === 'lucide-react') return { ShieldCheck: 'svg' };
    return { default: () => null };
  });
  const controller = { ...app.current, plan, checks: checkpoints, availableChecks: checkpoints, complete: async id => { checkpoints.find(check => check.id === id).status = 'completed'; } };
  const render = () => exports.default({ controller, packing: app.data, uid: 'owner', startDate: '2026-11-13', endDate: '2026-11-15' });
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  const button = walk(render()).find(node => node.type === 'button' && node.props.children === 'Complete check');
  await button.props.onClick();
  assert.ok(walk(render()).some(node => node.props?.className === 'travel-success'));
  assert.equal(helpers.nextTravelCheck(checkpoints).id, 'return-home');
});

test('existing notifications show due item checks during the trip, count only unresolved items and open the item-check page', async () => {
  const app = harness(); await app.render();
  const helpers = app.load('lib/travelChecks.ts'), messages = app.load('lib/messages.ts');
  const checkpoint = { ...helpers.checkpointDefinitions('trip', app.current.plan)[0], scheduledAt: new Date(Date.now() - 3600000).toISOString(), notificationMinutesBefore: 0, status: 'inProgress', snapshotAt: 'saved', items: helpers.snapshotPackedAssignments(app.data) };
  checkpoint.items[0].status = 'usedUp';
  const slots = []; let cursor = 0, language = 'en'; const opened = [];
  const react = { useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; }, useRef: () => ({ current: null }), useEffect() {} };
  const jsx = (type, props) => ({ type, props }), exports = {};
  const file = path.resolve(__dirname, '../components/NotificationCenter.tsx');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/travelChecks') return helpers;
    if (name === '@/lib/reminders') return app.load('lib/reminders.ts');
    if (name === '@/lib/useTravelCheckReminders') return { useTravelCheckReminders: () => [{ scope: 'local-owner_trip', check: checkpoint }] };
    if (name === '@/lib/i18n') return { useLanguage: () => ({ t: (key, params) => messages.translate(language, key, params), date: (value, time) => messages.formatDate(language, value, time) }) };
    return { Bell: 'svg', X: 'svg', CheckCheck: 'svg' };
  });
  const render = () => { cursor = 0; return exports.default({ accountId: 'local', trips: [{ id: 'trip', name: 'Original trip name', startDate: '2000-01-01', items: [] }], onOpen: (...args) => opened.push(args) }); };
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  walk(render()).find(node => node.props?.className === 'notification-trigger').props.onClick();
  const entry = walk(render()).find(node => node.props?.className?.includes('notification-entry'));
  const text = JSON.stringify(entry.props.children);
  assert.match(text, /Return-home check/); assert.match(text, /Unresolved items: 1/);
  entry.props.onClick(); assert.deepEqual(opened, [['trip', 'Item check']]);
  language = 'ja';
  walk(render()).find(node => node.props?.className === 'notification-trigger').props.onClick();
  assert.match(JSON.stringify(render()), /帰宅前チェック/);
  checkpoint.status = 'completed';
  assert.equal(walk(render()).filter(node => node.props?.className?.includes('notification-entry')).length, 0);
});
