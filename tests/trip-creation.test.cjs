const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}
const helpers = load('lib/tripCreation.ts');
const { packingTemplates } = load('lib/packingTemplates.ts');
const { requiredQuantity } = load('lib/packing.ts');
const pageText = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
const page = ts.createSourceFile('page.tsx', pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, context) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(page); assert.ok(initializer, `Actual page callback ${name} exists`);
  const code = ts.transpileModule('module.exports = ' + initializer.getText(page), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: null };
  new Function('module', ...Object.keys(context), code)(module, ...Object.values(context));
  return module.exports;
}
function creation(patch = {}, fetcher = async () => { throw new Error('No provider'); }) {
  const state = { draft: null, items: [], errors: [], loading: [], requests: [] };
  let nextId = 0;
  const context = {
    ...helpers, packingTemplates, requiredQuantity,
    tripCreationError: input => helpers.tripCreationError(input, '2030-01-01'),
    draftLoading: false, newType: 'Ski weekend', newName: 'User trip', newLocation: 'Sapporo, Japan', newStart: '2030-01-02', newEnd: '2030-01-04', newTravelers: ['Han', 'Aki'], newBudget: '1000', language: 'ja',
    tr: value => value, uid: () => `id-${++nextId}`,
    setDraftError: value => state.errors.push(value), setDraftLoading: value => state.loading.push(value), setDraftItems: value => { state.items = value; }, setTripDraft: value => { state.draft = value; },
    errorKey: (_error, fallback) => fallback,
    fetch: async (url, options) => { state.requests.push({ url, body: JSON.parse(options.body) }); return fetcher(url, options); },
    ...patch,
  };
  return { state, context, run: callback('addTrip', context) };
}

test('local dates use the browser calendar date rather than the UTC date', () => {
  const japan = { getTime: () => Date.UTC(2026, 10, 9, 16, 0), getTimezoneOffset: () => -540 };
  const america = { getTime: () => Date.UTC(2026, 10, 10, 2, 0), getTimezoneOffset: () => 480 };
  assert.equal(helpers.localTripDate(japan), '2026-11-10');
  assert.equal(helpers.localTripDate(america), '2026-11-09');
});

test('creation validates real calendar days, local today, date order, type and members', () => {
  const input = { type: 'Camping', destination: 'Tokyo', startDate: '2026-11-10', endDate: '2026-11-12', members: ['Han'] };
  assert.equal(helpers.tripCreationError(input, '2026-11-10'), '');
  assert.equal(helpers.tripCreationError({ ...input, startDate: '2026-11-09' }, '2026-11-10'), 'Start date must be today or later.');
  assert.equal(helpers.tripCreationError({ ...input, endDate: '2026-11-09' }, '2026-11-10'), 'End date must be on or after the start date.');
  for (const patch of [{ startDate: '2027-02-30' }, { endDate: '' }, { type: ' ' }, { type: 'x'.repeat(61) }, { members: [] }, { members: [''] }, { members: Array(101).fill('Han') }]) assert.ok(helpers.tripCreationError({ ...input, ...patch }, '2026-11-10'));
});

test('generated names are safe, deduplicated and capped for editable packing previews', () => {
  assert.deepEqual(helpers.checklistNames([' Tent ', null, 'tent', 'Ｔｅｎｔ', '', 'x'.repeat(201), 'Socks']), ['Tent', 'Socks']);
  assert.deepEqual(helpers.checklistNames(null), []);
  assert.equal(helpers.checklistNames(Array.from({ length: 25 }, (_, i) => 'Item ' + i)).length, 20);
});

test('known trip types keep the real member-based canonical templates without AI requests', async () => {
  const item = creation({ newType: ' camping ' }); await item.run();
  assert.equal(item.state.requests.length, 0);
  assert.equal(item.state.draft.type, 'Camping');
  assert.equal(item.state.draft.items.length, 0);
  assert.equal(item.state.items.find(item => item.template.id === 'sleeping-bag').quantity, 2);
  assert.equal(item.state.items.find(item => item.template.id === 'tent').quantity, 1);
  assert.equal(item.state.items.find(item => item.template.id === 'sleeping-bag').template.type, 'personal');
});

test('custom types request their own checklist and expose editable previews before saving', async () => {
  const item = creation({}, async () => Response.json({ configured: true, result: { suggestedItems: [' Ski goggles ', 'ski goggles', 'Gloves', null] } }));
  await item.run();
  assert.deepEqual(item.state.items.map(item => ({ name: item.name, quantity: item.quantity, template: item.template })), [{ name: 'Ski goggles', quantity: 1, template: undefined }, { name: 'Gloves', quantity: 1, template: undefined }]);
  assert.equal(item.state.draft.type, 'Ski weekend');
  assert.equal(item.state.draft.items.length, 0);
  assert.deepEqual(item.state.requests[0].body, { mode: 'checklist', language: 'ja', trip: { name: 'User trip', type: 'Ski weekend', location: 'Sapporo, Japan', startDate: '2030-01-02', endDate: '2030-01-04', people: 2 }, weather: null, items: [] });
  assert.deepEqual(item.state.loading, [true, false]);
});

test('no-key, network, malformed AI and provider errors leave a usable starter preview', async () => {
  for (const fetcher of [async () => Response.json({ configured: false }), async () => { throw new Error('offline'); }, async () => Response.json({ configured: true, result: { suggestedItems: [null, ''] } }), async () => Response.json({ error: 'unavailable' }, { status: 503 })]) {
    const item = creation({}, fetcher); await item.run();
    assert.deepEqual(item.state.items.map(item => item.name), helpers.customChecklistFallback);
    assert.equal(item.state.draft.type, 'Ski weekend');
    assert.equal(item.state.draft.items.length, 0);
    assert.ok(item.state.errors.includes('AI checklist is unavailable. Review the starter items or add your own.'));
    assert.equal(item.state.loading.at(-1), false);
  }
});

test('invalid dates and duplicate busy submission cannot create a trip or call AI', async () => {
  for (const patch of [{ newStart: '2029-12-31' }, { newEnd: '2030-01-01' }, { draftLoading: true }]) {
    const item = creation(patch); await item.run();
    assert.equal(item.state.requests.length, 0); assert.equal(item.state.draft, null); assert.equal(item.state.items.length, 0);
  }
});

test('confirmation persists user-edited preview through initialization without changing existing trips', async () => {
  const existing = { id: 'existing', items: [{ name: 'Keep status', status: 'Packed' }], pendingPacking: [] };
  let workspace = { trips: [existing], activeTripId: existing.id, history: [{ id: 'history' }] };
  const context = { confirming: { current: false }, initializeTrip: async (id, trip) => { assert.equal(id, trip.id); workspace = { ...workspace, trips: [trip, ...workspace.trips], activeTripId: id }; }, tripDraft: { id: 'new', type: 'Ski weekend', items: [] }, draftItems: [{ id: 'goggles', name: 'My edited goggles', quantity: 2 }] };
  for (const key of ['setDraftSaving', 'setTripDraft', 'setDraftItems', 'setDraftError', 'setNewName', 'setShowCreateTrip', 'setTab', 'setNotice']) context[key] = () => {};
  await callback('confirmTrip', context)();
  assert.equal(workspace.trips[1], existing);
  assert.equal(workspace.trips[0].items.length, 0);
  assert.equal(workspace.trips[0].pendingPacking[0].customName, 'My edited goggles');
  assert.equal(workspace.trips[0].pendingPacking[0].template.fixedQuantity, 2);
  assert.equal(workspace.activeTripId, 'new');
  assert.deepEqual(workspace.history, [{ id: 'history' }]);
});

test('workspace deletion selects a neighbor, preserves another active trip, and supports the last empty list', () => {
  const before = { trips: [{ id: 'a' }, { id: 'b', sharedChatId: 'kept-room' }, { id: 'c' }], activeTripId: 'b', history: [{ id: 'history' }] };
  const after = helpers.removeWorkspaceTrip(before, 'b');
  assert.equal(after.activeTripId, 'c'); assert.equal(before.trips.length, 3); assert.equal(after.history, before.history);
  assert.equal(helpers.removeWorkspaceTrip(before, 'a').activeTripId, 'b');
  const empty = helpers.removeWorkspaceTrip({ trips: [{ id: 'only' }], activeTripId: 'only', history: [] }, 'only');
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), { trips: [], activeTripId: '', history: [] });
});

test('actual delete button requires confirmation and removes only the selected workspace entry', () => {
  for (const approved of [false, true]) {
    const roomTrip = { id: 'delete', sharedChatId: 'shared-room', items: [] };
    let workspace = { trips: [roomTrip, { id: 'neighbor' }], activeTripId: 'delete', history: [{ id: 'kept-history' }] };
    const before = workspace;
    const notices = [];
    callback('deleteActiveTrip', { active: roomTrip, window: { confirm: () => approved }, tr: key => key, removeWorkspaceTrip: helpers.removeWorkspaceTrip, setWorkspace: fn => { workspace = fn(workspace); }, setTab: () => {}, setNotice: value => notices.push(value) })();
    if (!approved) { assert.equal(workspace, before); assert.equal(notices.length, 0); }
    else { assert.equal(workspace.trips.length, 1); assert.equal(workspace.activeTripId, 'neighbor'); assert.equal(roomTrip.sharedChatId, 'shared-room'); assert.equal(workspace.history, before.history); assert.equal(notices[0], 'Trip deleted.'); }
  }
});
