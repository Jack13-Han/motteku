const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, '..', file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', source)(exports, name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name));
  return exports;
}
const { convertPendingPacking, workspacePackingData, storeWorkspacePacking, mergeWorkspaceChanges, replaceWorkspaceTrip } = load('lib/workspacePacking.ts');
const { initializeWorkspaceTrip, firestorePayload } = load('lib/workspacePersistence.ts');
const { packingProgress, reconcilePacking } = load('lib/packing.ts');
const { packingTemplates } = load('lib/packingTemplates.ts');
const members = ['Aung', 'Phyu', 'Kyaw', 'Hnin', 'Yuki'].map((name, i) => ({ id: `member-${i}`, name }));
function trip(overrides = {}) {
  return { id: 'kan-chay-id', name: 'kan chay', people: 5, members, bags: [{ id: 'blue', name: 'Blue bag' }], items: [], pendingPacking: packingTemplates.Beach.map(template => ({ template })), ...overrides };
}
const shared = { id: 'tent', nameKey: 'Tent', category: 'Shelter', type: 'shared', quantityRule: 'fixed', fixedQuantity: 1, unitKey: 'unit.items' };

test('five members: every confirmed template becomes a TripItem with five independent personal assignments', () => {
  const original = trip();
  const converted = convertPendingPacking(original, 'owner');
  const data = workspacePackingData(converted, 'owner');
  assert.equal(converted.items.length, original.pendingPacking.length);
  for (const item of data.items.filter(i => i.type === 'personal')) {
    assert.equal(item.tripId, original.id);
    assert.equal(item.createdBy, 'owner');
    assert.ok(item.createdAt);
    assert.equal(item.quantity, 5 * item.template.quantityPerPerson);
    assert.deepEqual(item.targetMemberIds, members.map(m => m.id));
    const rows = data.assignments.filter(a => a.itemId === item.id);
    assert.equal(rows.length, 5);
    assert.equal(new Set(rows.map(a => a.id)).size, 5);
    assert.ok(rows.every(a => a.status === 'not_ready'));
  }
  assert.equal(data.items.find(i => i.template.id === 'towel').quantity, 10);
  const swimwear = data.items.find(i => i.template.id === 'swimwear');
  const updated = { ...data, assignments: data.assignments.map(a => a.itemId === swimwear.id && a.memberId === members[0].id ? { ...a, status: 'packed', bagId: 'blue' } : a) };
  const saved = storeWorkspacePacking(converted, updated);
  assert.equal(packingProgress(swimwear, saved.itemAssignments).packed, 1);
  assert.equal(saved.itemAssignments.filter(a => a.itemId === swimwear.id && a.status === 'not_ready').length, 4);
  assert.equal(saved.items.find(i => i.id === swimwear.id).status, 'Need to buy');
  assert.equal(original.items.length, 0);
  assert.ok(original.pendingPacking.length > 0);
  assert.deepEqual(converted.pendingPacking, []);
});

test('personal quantities use selected members, not the people count', () => {
  const converted = convertPendingPacking(trip({ people: 99, members: members.slice(0, 3) }), 'owner');
  assert.equal(converted.items.find(i => i.template.id === 'towel').quantity, 6);
  assert.equal(converted.itemAssignments.filter(a => a.itemId === 'template-towel').length, 3);
});

test('five-member camping trip converts personal and shared capacity templates together', () => {
  const input = trip({ pendingPacking: packingTemplates.Camping.map(template => ({ template })) });
  const converted = convertPendingPacking(input, 'owner');
  assert.equal(converted.items.length, packingTemplates.Camping.length);
  const tent = converted.items.find(i => i.template.id === 'tent');
  assert.equal(tent.quantity, 2);
  assert.equal(converted.itemAssignments.filter(a => a.itemId === tent.id).length, 2);
  assert.equal(converted.items.find(i => i.template.id === 'water-bottle').quantity, 5);
});

test('explicit personal targets and their quantity remain selected after reconciliation', () => {
  const template = packingTemplates.Beach.find(t => t.id === 'towel');
  const converted = convertPendingPacking(trip({ pendingPacking: [{ template, targetMemberIds: members.slice(0, 2).map(m => m.id) }] }), 'owner');
  const data = reconcilePacking(workspacePackingData(converted, 'owner'), members, converted.id, 'owner');
  assert.equal(data.items[0].quantity, 4);
  assert.deepEqual(data.items[0].targetMemberIds, members.slice(0, 2).map(m => m.id));
  assert.equal(data.assignments.length, 2);
});

test('shared quantities, assignees, statuses, bags, categories and translation keys survive conversion', () => {
  const input = trip({ pendingPacking: [{ template: shared, quantity: 2, assignee: 'Phyu', status: 'Purchased', bagId: 'blue', category: 'Camp gear' }] });
  const converted = convertPendingPacking(input, 'owner');
  const item = converted.items[0];
  assert.equal(item.quantity, 2);
  assert.equal(item.assignee, 'Phyu');
  assert.equal(item.status, 'Purchased');
  assert.equal(item.bagId, 'blue');
  assert.equal(item.category, 'Camp gear');
  assert.equal(item.name, 'Tent');
  assert.equal(item.template.nameKey, 'Tent');
  assert.equal(converted.itemAssignments.length, 2);
  assert.ok(converted.itemAssignments.every(a => a.memberId === members[1].id && a.status === 'ready' && a.bagId === 'blue'));
  const recalculated = reconcilePacking(workspacePackingData(converted, 'owner'), members, input.id, 'owner');
  assert.equal(recalculated.items[0].quantity, 2);
});

test('shared units preserve their individual owner, status and bag', () => {
  const input = trip({ pendingPacking: [{ template: shared, quantity: 2, units: [{ memberId: members[0].id, status: 'packed', bagId: 'blue' }, { memberId: members[2].id, status: 'not_ready', bagId: '' }] }] });
  const converted = convertPendingPacking(input, 'owner');
  assert.deepEqual(converted.itemAssignments.map(a => [a.unitNumber, a.memberId, a.status, a.bagId]), [[1, members[0].id, 'packed', 'blue'], [2, members[2].id, 'not_ready', '']]);
});

test('custom names stay untranslated and legacy shopping metadata remains unchanged', () => {
  const legacy = { id: 'legacy', name: 'My custom food', quantity: 4, status: 'Purchased', category: 'Food', assignee: 'Hnin', bagId: 'blue', price: 1200 };
  const converted = convertPendingPacking(trip({ items: [legacy], pendingPacking: [{ template: shared, customName: 'Our blue tent' }] }), 'owner');
  assert.deepEqual(converted.items.find(i => i.id === 'legacy'), legacy);
  assert.equal(converted.items.find(i => i.id === 'template-tent').name, 'Our blue tent');
  assert.equal(converted.items.find(i => i.id === 'template-tent').customName, true);
});

test('retry fills missing assignments without duplicating items or resetting existing checks or metadata', () => {
  const original = trip();
  const first = convertPendingPacking(original, 'owner');
  first.items[0].category = 'Personal override';
  first.items[0].bagId = 'blue';
  first.itemAssignments[0] = { ...first.itemAssignments[0], status: 'packed', bagId: 'blue' };
  const retained = first.itemAssignments[0];
  const pending = { ...first, pendingPacking: original.pendingPacking, itemAssignments: first.itemAssignments.slice(0, 1) };
  const second = convertPendingPacking(pending, 'owner');
  assert.equal(second.items.length, first.items.length);
  assert.equal(second.itemAssignments.length, first.itemAssignments.length);
  assert.deepEqual(second.itemAssignments[0], retained);
  assert.equal(second.items[0].category, 'Personal override');
  assert.equal(second.items[0].bagId, 'blue');
  assert.equal(new Set(second.items.map(i => i.id)).size, second.items.length);
  assert.deepEqual(convertPendingPacking(second, 'owner'), second);
});

test('an existing partial item is upgraded once, preserving saved quantity and shopping fields', () => {
  const partial = { id: 'template-tent', name: 'Tent', quantity: 2, category: 'Already saved', status: 'Purchased', assignee: 'Hnin', bagId: 'blue', price: 3000 };
  const converted = convertPendingPacking(trip({ items: [partial], pendingPacking: [{ template: shared }] }), 'owner');
  assert.equal(converted.items.length, 1);
  assert.equal(converted.items[0].quantity, 2);
  assert.equal(converted.items[0].price, 3000);
  assert.equal(converted.items[0].category, 'Already saved');
  assert.equal(converted.items[0].assignee, 'Hnin');
  assert.equal(converted.items[0].status, 'Purchased');
  assert.ok(converted.itemAssignments.every(a => a.memberId === members[3].id && a.bagId === 'blue' && a.status === 'ready'));
});

test('trip selection uses unique IDs despite duplicate names and reordered arrays', () => {
  const target = trip();
  const other = { ...trip(), id: 'other-id', secret: { preserved: true } };
  const document = { trips: [other, target], activeTripId: other.id, history: [{ id: 'history' }], unknownField: { keep: 42 } };
  const next = replaceWorkspaceTrip(document, target.id, t => convertPendingPacking(t, 'owner'));
  assert.deepEqual(next.trips[0], other);
  assert.ok(next.trips.find(t => t.id === target.id).items.length > 0);
  assert.equal(next.activeTripId, other.id);
  assert.deepEqual(next.history, document.history);
  assert.deepEqual(next.unknownField, document.unknownField);
  assert.throws(() => replaceWorkspaceTrip(document, 'missing', t => t));
});

test('stale workspace edits preserve server-initialized items, other trips and unknown fields', () => {
  const old = { trips: [trip()], activeTripId: 'kan-chay-id', history: [] };
  const edited = { ...old, trips: [{ ...old.trips[0], name: 'New name' }] };
  const current = { ...old, unknown: 'keep', trips: [trip({ id: 'concurrent-trip' }), convertPendingPacking(old.trips[0], 'owner')] };
  const merged = mergeWorkspaceChanges(old, edited, current);
  const saved = merged.trips.find(t => t.id === 'kan-chay-id');
  assert.equal(saved.name, 'New name');
  assert.ok(saved.items.length > 0);
  assert.deepEqual(saved.pendingPacking, []);
  assert.equal(merged.trips.length, 2);
  assert.equal(merged.unknown, 'keep');
});

test('a stale edit does not resurrect a trip deleted on another device', () => {
  const before = { trips: [trip(), trip({ id: 'deleted' })] };
  const after = { trips: [{ ...before.trips[0], name: 'Changed' }, before.trips[1]] };
  const current = { trips: [before.trips[0]] };
  const merged = mergeWorkspaceChanges(before, after, current);
  assert.deepEqual(merged.trips.map(t => t.id), ['kan-chay-id']);
  assert.equal(merged.trips[0].name, 'Changed');
});

function repository(initial) {
  let data = initial;
  const calls = [];
  return { calls, get data() { return data; }, async update(change) { calls.push('write'); const next = change(data); data = next; calls.push('committed'); }, async reload() { calls.push('reload'); return data; } };
}

test('initialization acknowledges only the committed and reloaded exact trip', async () => {
  const store = repository({ trips: [trip({ id: 'other' }), trip()], activeTripId: 'other', untouched: 42 });
  const saved = await initializeWorkspaceTrip(store, 'owner', 'kan-chay-id');
  assert.deepEqual(store.calls, ['write', 'committed', 'reload']);
  assert.ok(saved.trips.find(t => t.id === 'kan-chay-id').items.length > 0);
  assert.equal(saved.trips[0].items.length, 0);
  assert.equal(saved.untouched, 42);
  assert.equal(saved.activeTripId, 'other');
});

test('rejected writes keep pending data and log Firebase code, full message, trip ID and payload', async () => {
  const initial = { trips: [trip()], activeTripId: 'kan-chay-id' };
  const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const logs = [], previous = console.error;
  console.error = (...args) => logs.push(args);
  let read = false;
  try {
    const store = { async update(change) { change(initial); throw failure; }, async reload() { read = true; return initial; } };
    await assert.rejects(initializeWorkspaceTrip(store, 'owner', 'kan-chay-id'), failure);
  } finally { console.error = previous; }
  assert.equal(read, false);
  assert.equal(initial.trips[0].items.length, 0);
  assert.ok(initial.trips[0].pendingPacking.length > 0);
  const detail = logs[0][1];
  assert.equal(detail.code, 'permission-denied');
  assert.equal(detail.message, failure.message);
  assert.equal(detail.tripId, 'kan-chay-id');
  assert.equal(detail.path, 'users/owner/workspace/main');
  assert.ok(detail.rejectedPayload.trips[0].items.length > 0);
});

test('readback failure is not success; retry after a committed write remains idempotent', async () => {
  const store = repository({ trips: [trip()], activeTripId: 'kan-chay-id' });
  const reload = store.reload;
  store.reload = async () => { throw Object.assign(new Error('Server unavailable'), { code: 'unavailable' }); };
  const previous = console.error; console.error = () => {};
  try { await assert.rejects(initializeWorkspaceTrip(store, 'owner', 'kan-chay-id'), /Server unavailable/); } finally { console.error = previous; }
  const count = store.data.trips[0].items.length;
  store.reload = reload;
  const saved = await initializeWorkspaceTrip(store, 'owner', 'kan-chay-id');
  assert.equal(saved.trips[0].items.length, count);
  assert.deepEqual(saved.trips[0].pendingPacking, []);
});

test('empty server readback is rejected, and new trip confirmation preserves existing trips', async () => {
  const store = repository({ trips: [trip({ id: 'existing' })], activeTripId: 'existing', other: 'unchanged' });
  const saved = await initializeWorkspaceTrip(store, 'owner', 'kan-chay-id', trip());
  assert.equal(saved.trips.length, 2);
  assert.equal(saved.activeTripId, 'kan-chay-id');
  assert.equal(saved.other, 'unchanged');
  const previous = console.error; console.error = () => {};
  try { await assert.rejects(initializeWorkspaceTrip({ ...store, reload: async () => ({ trips: [trip()], activeTripId: 'kan-chay-id' }) }, 'owner', 'kan-chay-id'), /could not be verified/); } finally { console.error = previous; }
});

test('Firestore payload sanitization removes undefined while retaining real timestamps', () => {
  const converted = convertPendingPacking(trip(), 'owner');
  const payload = firestorePayload({ ...converted, inviteCode: undefined });
  assert.equal(Object.hasOwn(payload, 'inviteCode'), false);
  assert.equal(typeof payload.items[0].createdAt.toMillis, 'function');
});

test('Firestore adapter writes and reloads the exact workspace document without subcollections', async () => {
  const target = trip();
  const other = trip({ id: 'other', name: target.name });
  let document = { trips: [other, target], activeTripId: target.id, history: [{ id: 'history' }], customField: { keep: true } };
  const calls = [];
  const firestore = {
    doc(_database, ...segments) { const ref = { path: segments.join('/') }; calls.push(['doc', ref.path]); return ref; },
    async runTransaction(_database, change) {
      await change({
        async get(ref) { calls.push(['get', ref.path]); return { exists: () => true, data: () => document }; },
        set(ref, payload, options) { calls.push(['set', ref.path, options]); document = payload; },
      });
    },
    async getDocFromServer(ref) { calls.push(['server-read', ref.path]); return { exists: () => true, data: () => document }; },
  };
  const file = path.resolve(__dirname, '../lib/workspacePersistence.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', source)(exports, name => name === 'firebase/firestore' ? firestore : load(path.resolve(path.dirname(file), `${name}.ts`)));
  const store = exports.workspaceRepository({}, 'signed-in-user', document);
  const saved = await exports.initializeWorkspaceTrip(store, 'signed-in-user', target.id);
  assert.ok(calls.every(call => call[1] === 'users/signed-in-user/workspace/main'));
  assert.deepEqual(calls.map(call => call[0]), ['doc', 'get', 'set', 'server-read']);
  assert.deepEqual(calls[2][2], { merge: true });
  assert.ok(saved.trips.find(t => t.id === target.id).items.length > 0);
  assert.deepEqual(saved.trips.find(t => t.id === other.id), other);
  assert.deepEqual(saved.customField, { keep: true });
  assert.deepEqual(saved.history, [{ id: 'history' }]);
});

test('pending data is not cleared locally and success does not resolve before commit and server readback', async () => {
  const initial = { trips: [trip()], activeTripId: 'kan-chay-id' };
  let document = initial;
  let finishCommit, finishRead;
  const committed = new Promise(resolve => { finishCommit = resolve; });
  const serverRead = new Promise(resolve => { finishRead = resolve; });
  let completed = false;
  const store = {
    async update(change) { const next = change(document); await committed; document = next; },
    async reload() { await serverRead; return document; },
  };
  const operation = initializeWorkspaceTrip(store, 'owner', 'kan-chay-id').then(saved => { completed = true; return saved; });
  assert.ok(initial.trips[0].pendingPacking.length > 0);
  assert.equal(document.trips[0].items.length, 0);
  assert.equal(completed, false);
  finishCommit();
  await committed;
  assert.ok(document.trips[0].items.length > 0);
  assert.equal(completed, false);
  finishRead();
  const saved = await operation;
  assert.equal(completed, true);
  assert.deepEqual(saved.trips[0].pendingPacking, []);
  assert.ok(initial.trips[0].pendingPacking.length > 0);
});
