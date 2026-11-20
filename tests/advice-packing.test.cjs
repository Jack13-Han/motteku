const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const firestore = require('firebase/firestore');
const root = path.resolve(__dirname, '..');

// Execute the actual helper and createPackingItem; only Firebase I/O is recorded.
const serverTime = { type: 'server-timestamp' };
const ref = (parent, ...parts) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') });
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', compiled)(exports, name => name === 'firebase/firestore' ? { ...firestore, doc: ref, serverTimestamp: () => serverTime } : name.startsWith('./') ? load(path.join(path.dirname(relative), name.slice(2) + '.ts')) : require(name));
  cache.set(relative, exports);
  return exports;
}
const { addAdviceItem } = load('lib/addAdviceItem.ts');

// Extract actual usePacking.mutate to verify its busy/failure contract as well.
const controllerSource = ts.createSourceFile('usePacking.ts', fs.readFileSync(path.join(root, 'lib/usePacking.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const hook = controllerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePacking');
const mutateNode = hook.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mutate');
const mutateSource = ts.transpileModule(mutateNode.getText(controllerSource), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function data() {
  return { ownerUid: 'owner', adminUids: ['admin'], members: [{ id: 'owner-member', name: 'Owner', uid: 'owner' }, { id: 'member-a', name: 'A', uid: 'user-a', active: true }, { id: 'admin-member', name: 'Admin', uid: 'admin' }, { id: 'former-member', name: 'Former', uid: 'former', active: false }], bags: [{ id: 'bag-1', name: 'Backpack' }], items: [], assignments: [] };
}

function controller(options = {}) {
  const state = { data: options.data || data(), loaded: options.loaded ?? true, busy: options.busy ?? false, error: '', commits: [], commitAttempts: 0, localWrites: [], busyChanges: [] };
  const saving = { current: options.saving ?? false };
  const writeBatch = () => {
    const pending = [];
    return {
      set(reference, value) { pending.push({ path: reference.path, value }); return this; },
      async commit() {
        state.commitAttempts++;
        if (options.wait) await options.wait;
        if (options.fail) throw new Error('Simulated permission-denied');
        state.commits.push(pending);
      },
    };
  };
  const scope = 'trip-current';
  const mutate = new Function('data', 'loaded', 'dataScope', 'scope', 'saving', 'setBusy', 'setError', 'cloud', 'db', 'writeBatch', 'doc', 'localKey', 'localStorage', 'setData', mutateSource + ';return mutate;')(
    state.data, state.loaded, options.dataScope || scope, scope, saving,
    value => { state.busy = value; state.busyChanges.push(value); },
    value => { state.error = value; }, options.cloud ?? true, { path: '' }, writeBatch, ref,
    'motteku-packing-v2:' + scope,
    { setItem(key, value) { if (options.fail) throw new Error('Storage full'); state.localWrites.push({ key, value }); } },
    value => { state.data = value; },
  );
  const packing = { get data() { return state.data; }, get loaded() { return state.loaded; }, get busy() { return state.busy; }, mutate };
  return { packing, state, saving, scope };
}

test('personal suggestions write one canonical item and one assignment per active member', async () => {
  const c = controller();
  assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), true);
  assert.equal(c.state.commits.length, 1);
  const writes = c.state.commits[0];
  assert.equal(writes.length, 4);
  const item = writes[0];
  assert.match(item.path, /^packingTrips\/trip-current\/items\//);
  assert.equal(item.value.tripId, 'trip-current');
  assert.equal(item.value.createdBy, 'owner');
  assert.equal(item.value.name, 'Rain jacket');
  assert.equal(item.value.type, 'personal');
  assert.deepEqual(item.value.targetMemberIds, ['owner-member', 'member-a', 'admin-member']);
  assert.equal(item.value.createdAt, serverTime);
  for (const row of writes.slice(1)) {
    assert.match(row.path, /^packingTrips\/trip-current\/itemAssignments\//);
    assert.equal(row.value.itemId, item.value.id);
    assert.equal(row.value.tripId, 'trip-current');
    assert.equal(row.value.status, 'not_ready');
    assert.equal(row.value.bagId, '');
    assert.equal(row.value.updatedAt, serverTime);
  }
  assert.deepEqual(writes.slice(1).map(row => row.value.memberId), item.value.targetMemberIds);
  assert.equal(writes.some(row => row.path.includes('workspace') || row.path.includes('legacy')), false);
  assert.deepEqual(c.state.busyChanges, [true, false]);
});

test('shared suggestions add one unit assigned to the current admin account', async () => {
  const c = controller();
  assert.equal(await addAdviceItem(c.packing, c.scope, 'admin', 'First aid kit', 'shared'), true);
  const [item, assignment] = c.state.commits[0];
  assert.equal(c.state.commits[0].length, 2);
  assert.equal(item.value.type, 'shared');
  assert.equal(item.value.quantity, 1);
  assert.deepEqual(item.value.targetMemberIds, []);
  assert.equal(assignment.value.memberId, 'admin-member');
  assert.equal(assignment.value.unitNumber, 1);
  assert.equal(assignment.value.itemId, item.value.id);
});

test('already-present suggestion returns success without writing a duplicate or changing flags', async () => {
  const existing = data(); existing.items.push({ id: 'kept-item', name: '  Rain Jacket  ' });
  const c = controller({ data: existing });
  assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'rain jacket', 'personal'), true);
  assert.equal(c.state.data, existing);
  assert.equal(c.state.commitAttempts, 0);
  assert.deepEqual(c.state.busyChanges, []);
  assert.equal(c.saving.current, false);
});

test('ordinary members and missing accounts cannot add suggestions', async () => {
  for (const uid of ['user-a', 'outsider', '']) {
    const c = controller();
    await assert.rejects(addAdviceItem(c.packing, c.scope, uid, 'Rain jacket', 'personal'), /organizer or an admin/);
    assert.equal(c.state.commitAttempts, 0);
    assert.deepEqual(c.state.busyChanges, []);
  }
});

test('empty active rosters cannot create personal or shared packing rows', async () => {
  for (const type of ['personal', 'shared']) {
    const current = data(); current.members = current.members.map(member => ({ ...member, active: false }));
    const c = controller({ data: current });
    await assert.rejects(addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', type));
    assert.equal(c.state.commitAttempts, 0);
    assert.equal(c.state.data.items.length, 0);
    assert.deepEqual(c.state.busyChanges, []);
  }
});

test('busy, unloaded and absent controllers reject writes without side effects', async () => {
  const absent = controller(); absent.state.data = null;
  for (const c of [controller({ busy: true }), controller({ loaded: false }), absent]) {
    await assert.rejects(addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), /organizer or an admin/);
    assert.equal(c.state.commitAttempts, 0);
    assert.deepEqual(c.state.busyChanges, []);
  }
});

test('scope changes and in-flight saves return false without canonical writes', async () => {
  for (const c of [controller({ dataScope: 'previous-trip' }), controller({ saving: true })]) {
    assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), false);
    assert.equal(c.state.commitAttempts, 0);
    assert.deepEqual(c.state.busyChanges, []);
  }
});

test('failed cloud save returns false, keeps packing data intact and releases saving flags', async () => {
  const c = controller({ fail: true });
  const original = c.state.data;
  assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), false);
  assert.equal(c.state.data, original);
  assert.equal(original.items.length, 0);
  assert.equal(original.assignments.length, 0);
  assert.equal(c.state.commits.length, 0);
  assert.equal(c.state.commitAttempts, 1);
  assert.equal(c.state.busy, false);
  assert.equal(c.state.loaded, true);
  assert.equal(c.saving.current, false);
  assert.equal(c.state.error, 'Could not save changes.');
  assert.deepEqual(c.state.busyChanges, [true, false]);
});

test('local-mode suggestions update the canonical packing store without changing legacy trip data', async () => {
  const c = controller({ cloud: false });
  assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), true);
  assert.equal(c.state.commitAttempts, 0);
  assert.equal(c.state.localWrites.length, 1);
  assert.equal(c.state.localWrites[0].key, 'motteku-packing-v2:trip-current');
  const saved = JSON.parse(c.state.localWrites[0].value);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.assignments.length, 3);
  assert.equal(c.state.data.items.length, 1);
  assert.equal(Object.hasOwn(saved, 'trips'), false);
  assert.equal(Object.hasOwn(saved, 'activeTripId'), false);
});

test('failed local save keeps old data and clears saving flags', async () => {
  const c = controller({ cloud: false, fail: true });
  const original = c.state.data;
  assert.equal(await addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal'), false);
  assert.equal(c.state.data, original);
  assert.equal(c.state.localWrites.length, 0);
  assert.equal(c.state.busy, false);
  assert.equal(c.saving.current, false);
});

test('a concurrent click cannot bypass the controller saving guard', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const c = controller({ wait: waiting });
  const first = addAdviceItem(c.packing, c.scope, 'owner', 'Rain jacket', 'personal');
  await assert.rejects(addAdviceItem(c.packing, c.scope, 'owner', 'First aid kit', 'shared'), /organizer or an admin/);
  finish();
  assert.equal(await first, true);
  assert.equal(c.state.commitAttempts, 1);
  assert.equal(c.state.commits.length, 1);
  assert.equal(c.state.busy, false);
});
