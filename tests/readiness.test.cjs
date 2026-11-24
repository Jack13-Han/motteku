const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
const timestamp = { seconds: 1794900000, nanoseconds: 0 };
const requirement = (itemId, createdAt = timestamp) => ({ itemId, createdBy: 'alice', createdAt });
const personal = { id: 'passport', tripId: 'one', name: 'Passport', type: 'personal', quantity: 1, targetMemberIds: ['a', 'b'], createdBy: 'alice', createdAt: timestamp, updatedAt: timestamp };
const shared = { ...personal, id: 'ticket', name: 'Tickets', type: 'shared', quantity: 2, targetMemberIds: [] };
const assignment = (id, itemId, memberId, patch = {}) => ({ id, tripId: 'one', itemId, memberId, status: 'packed', bagId: '', updatedAt: timestamp, ...patch });
function packingData() { return { ownerUid: 'alice', adminUids: [], bags: [], members: [{ id: 'a', name: 'Alice', uid: 'alice' }, { id: 'b', name: 'Bob', uid: 'bob' }], items: [personal, shared], assignments: [assignment('passport_a', 'passport', 'a'), assignment('passport_b', 'passport', 'b'), assignment('ticket_unit_1', 'ticket', 'a', { unitNumber: 1 }), assignment('ticket_unit_2', 'ticket', 'b', { unitNumber: 2 })] }; }
const transpile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const normalize = value => JSON.parse(JSON.stringify(value));

function modules(extra = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(extra, name)) return extra[name];
    if (name === 'firebase/firestore') return { Timestamp: class Timestamp {} };
    const relative = name === './packing' ? 'lib/packing.ts' : name === '@/lib/packing' ? 'lib/packing.ts' : name === '@/lib/readiness' ? 'lib/readiness.ts' : null;
    if (!relative) throw new Error('Unexpected import: ' + name);
    return read(relative);
  }
  function read(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const target = { exports: {} }; cache.set(relative, target.exports);
    vm.runInNewContext(transpile(path.join(project, relative)), { module: target, exports: target.exports, require: load, crypto: webcrypto, TextEncoder, Uint8Array, ...extra.globals }, { filename: relative });
    return target.exports;
  }
  return { read };
}
const lib = modules().read('lib/readiness.ts');
async function hashMap(data, requirements) { return Object.fromEntries(await Promise.all(data.members.filter(member => member.active !== false).map(async member => [member.id, await lib.hashReadinessContext(lib.readinessContext(data, requirements, member.id))]))); }
const confirmations = hashes => Object.entries(hashes).map(([memberId, contextHash]) => ({ memberId, uid: memberId === 'a' ? 'alice' : 'bob', contextHash, confirmedAt: timestamp }));

test('readiness requires complete current coverage, actual packed status and every linked member declaration', async () => {
  const data = packingData(), requirements = [requirement('passport'), requirement('ticket')];
  const hashes = await hashMap(data, requirements), saved = confirmations(hashes);
  const summary = lib.departureSummary(data, requirements, saved, hashes);
  assert.equal(summary.ready, true); assert.equal(summary.total, 4); assert.equal(summary.packed, 4);
  assert.equal(lib.departureSummary(data, requirements, saved.slice(0, 1), hashes).ready, false);
  const missing = { ...data, assignments: data.assignments.filter(row => row.id !== 'passport_b') };
  assert.equal(lib.departureSummary(missing, requirements, saved, hashes).ready, false);
  const unpacked = { ...data, assignments: data.assignments.map(row => row.id === 'passport_b' ? { ...row, status: 'ready' } : row) };
  assert.equal(lib.departureSummary(unpacked, requirements, saved, hashes).ready, false, 'forged or old hashes cannot override actual packing');
});

test('shared essentials block everyone when missing, unassigned, inactive, duplicated or stale', () => {
  const data = packingData(), requirements = [requirement('ticket')];
  for (const assignments of [
    data.assignments.filter(row => row.id !== 'ticket_unit_2'),
    data.assignments.map(row => row.id === 'ticket_unit_2' ? { ...row, memberId: '' } : row),
    data.assignments.map(row => row.id === 'ticket_unit_2' ? { ...row, memberId: 'removed' } : row),
    [...data.assignments, data.assignments.find(row => row.id === 'ticket_unit_2')],
    data.assignments.map(row => row.id === 'ticket_unit_2' ? { ...row, unitNumber: 3 } : row),
    data.assignments.map(row => row.id === 'ticket_unit_2' ? { ...row, unitNumber: 1 } : row),
  ]) {
    const summary = lib.departureSummary({ ...data, assignments }, requirements, [], {});
    assert.equal(summary.packed, 1);
    assert.ok(summary.members.every(member => member.blocked.length === 1));
  }
  const extra = { ...data, assignments: [...data.assignments, assignment('ticket_unit_3', 'ticket', 'a', { unitNumber: 3, status: 'not_ready' })] };
  assert.equal(lib.requiredChecks(extra, requirements).length, 2, 'obsolete rows do not enlarge current quantity');
});

test('a mismatched personal row blocks its intended member rather than a different assignee', () => {
  const data = packingData(); data.assignments.find(row => row.id === 'passport_a').memberId = 'b';
  const summary = lib.departureSummary(data, [requirement('passport')], [], {});
  assert.equal(summary.members[0].blocked.length, 1);
  assert.equal(summary.members[1].blocked.length, 0);
});

test('empty requirements allow self declarations while missing items and empty rosters never report false ready', async () => {
  const data = packingData(), hashes = await hashMap(data, []);
  assert.equal(lib.departureSummary(data, [], confirmations(hashes), hashes).ready, true);
  assert.equal(lib.departureSummary({ ...data, members: [] }, [], [], {}).ready, false);
  assert.equal(lib.departureSummary(data, [requirement('removed')], confirmations(hashes), hashes).ready, false);
  assert.equal(lib.requiredChecks({ ...data, items: [{ ...personal, targetMemberIds: [] }] }, [requirement('passport')])[0].packed, false);
});

test('unlinked, inactive and ambiguously linked members cannot inherit someone else confirmation', async () => {
  const data = packingData();
  assert.equal(lib.linkedReadinessMember(data, 'alice').id, 'a');
  assert.equal(lib.linkedReadinessMember(data, ''), undefined);
  const unlinked = { ...data, members: data.members.map(member => member.id === 'b' ? { ...member, uid: '' } : member) };
  assert.equal(lib.departureSummary(unlinked, [], [], {}).members[1].linked, false);
  const ambiguous = { ...data, members: [...data.members, { id: 'another', uid: 'alice', name: 'Another Alice' }] };
  assert.equal(lib.linkedReadinessMember(ambiguous, 'alice'), undefined);
  assert.ok(lib.departureSummary(ambiguous, [], [], {}).members.filter(row => row.member.uid === 'alice').every(row => !row.linked));
  const removed = { ...data, members: data.members.map(member => member.id === 'b' ? { ...member, active: false } : member) };
  assert.equal(lib.departureSummary(removed, [], [], {}).members.length, 1);
});

test('hash context invalidates re-marking, roster changes and relevant checks; another personal check does not invalidate mine', async () => {
  const data = packingData(), requirements = [requirement('passport'), requirement('ticket')];
  const initial = lib.readinessContext(data, requirements, 'a');
  assert.equal(await lib.hashReadinessContext(initial), await lib.hashReadinessContext(initial));
  assert.match(await lib.hashReadinessContext(initial), /^[a-f0-9]{64}$/);
  const changed = row => ({ ...row, updatedAt: { seconds: timestamp.seconds + 1, nanoseconds: 0 } });
  const bob = { ...data, assignments: data.assignments.map(row => row.id === 'passport_b' ? changed({ ...row, status: 'not_ready' }) : row) };
  assert.equal(lib.readinessContext(bob, requirements, 'a'), initial);
  for (const next of [
    { ...data, assignments: data.assignments.map(row => row.id === 'passport_a' ? changed(row) : row) },
    { ...data, assignments: data.assignments.map(row => row.id === 'ticket_unit_2' ? changed({ ...row, bagId: 'bag' }) : row) },
    { ...data, members: [...data.members, { id: 'c', name: 'Carol', uid: 'carol' }] },
  ]) assert.notEqual(lib.readinessContext(next, requirements, 'a'), initial);
  assert.notEqual(lib.readinessContext(data, [requirement('passport', { seconds: timestamp.seconds + 1, nanoseconds: 0 }), requirement('ticket')], 'a'), initial);
  const savedHash = { a: await lib.hashReadinessContext(initial) };
  const changedHash = await hashMap(data, [requirement('passport')]);
  assert.equal(lib.departureSummary(data, requirements, confirmations(savedHash), changedHash).members[0].stale, true);
});

test('safe error text never exposes transport details', () => {
  assert.match(lib.readinessError({ code: 'permission-denied', message: 'SECRET' }, 'save'), /publish the latest Firestore rules/);
  assert.equal(lib.readinessError(new Error('SECRET'), 'save').includes('SECRET'), false);
});

test('context uses scope and stable code-unit ordering independent of snapshot order', () => {
  const data = packingData(), requirements = [requirement('passport'), requirement('ticket')];
  const context = lib.readinessContext(data, requirements, 'a', 'one');
  const reordered = { ...data, members: [...data.members].reverse(), items: [...data.items].reverse(), assignments: [...data.assignments].reverse() };
  assert.equal(lib.readinessContext(reordered, [...requirements].reverse(), 'a', 'one'), context);
  assert.notEqual(lib.readinessContext(data, requirements, 'a', 'two'), context);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(options = {}) {
  let props = { scope: 'one', uid: 'alice', packing: { data: packingData(), cloud: options.cloud !== false, loaded: true, synced: true, busy: false }, ...options.props };
  const slots = [], effects = [], writes = [], listeners = [], local = new Map(), auth = { currentUser: { uid: props.uid } };
  // Keep real WebCrypto hashing, but wait for its work rather than assuming a
  // fixed number of event-loop turns is enough under parallel test load.
  const digestTasks = new Set();
  const trackedCrypto = { subtle: { digest(...args) {
    const task = webcrypto.subtle.digest(...args);
    digestTasks.add(task);
    void task.then(() => digestTasks.delete(task), () => digestTasks.delete(task));
    return task;
  } } };
  let index = 0, dirty = false, tree, unmounted = false;
  const collections = { departureRequirements: options.requirements || [], departureConfirmations: options.confirmations || [] };
  const react = {
    useState(initial) { const id = index++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], value => { if (!unmounted) { slots[id] = typeof value === 'function' ? value(slots[id]) : value; dirty = true; } }]; },
    useRef(initial) { const id = index++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(effect, deps) { const id = index++, old = slots[id]; if (!old || deps.some((value, at) => !Object.is(value, old.deps[at]))) effects.push(() => { old?.cleanup?.(); slots[id] = { deps, cleanup: effect() }; }); },
  };
  const reference = (...parts) => ({ path: parts.map(part => typeof part === 'string' ? part : part?.path || '').filter(Boolean).join('/') });
  const firestore = {
    collection: reference, doc: reference, serverTimestamp: () => 'SERVER_TIMESTAMP',
    onSnapshot(ref, _options, next, fail) { const listener = { ref, next, fail, active: true }; listeners.push(listener); const kind = ref.path.split('/').at(-1); next({ docs: collections[kind].map(value => ({ id: value.itemId || value.uid, data: () => value })), metadata: { hasPendingWrites: false, fromCache: false } }); return () => { listener.active = false; }; },
    setDoc(ref, value) { const result = deferred(); writes.push({ ref, value, result, operation: 'set' }); return result.promise; },
    deleteDoc(ref) { const result = deferred(); writes.push({ ref, result, operation: 'delete' }); return result.promise; },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const loadedModules = modules({ react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, 'firebase/firestore': firestore, '@/lib/firebase': { db: {}, auth }, '@/lib/i18n': { useLanguage: () => ({ t: (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`) }) }, globals: { crypto: trackedCrypto, localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => { if (options.localFailure) throw new Error('SECRET LOCAL'); local.set(key, value); } } } });
  const Component = loadedModules.read('components/DepartureReadiness.tsx').default;
  function render() { if (unmounted) return; let loops = 0; do { if (++loops > 40) throw new Error('Render loop'); dirty = false; index = 0; tree = Component(props); while (effects.length) effects.shift()(); } while (dirty); }
  function nodes(node) { if (arguments.length === 0) node = tree; if (node == null || typeof node === 'boolean') return []; if (Array.isArray(node)) return node.flatMap(value => nodes(value)); if (typeof node !== 'object') return [node]; return [node, ...nodes(node.props.children)]; }
  const textOf = node => nodes(node).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
  const button = label => { const found = nodes().find(node => node?.type === 'button' && textOf(node).trim() === label); assert.ok(found, 'Missing button: ' + label); return found; };
  function emit(kind, values, metadata = {}) { collections[kind] = values; for (const listener of listeners.filter(row => row.active && row.ref.path.endsWith('/' + kind))) listener.next({ docs: values.map(value => ({ id: value.itemId || value.uid, data: () => value })), metadata: { hasPendingWrites: false, fromCache: false, ...metadata } }); render(); }
  async function flush() { for (let turn = 0; turn < 8; turn++) { await Promise.all([...digestTasks]); await new Promise(resolve => setImmediate(resolve)); render(); } }
  async function commit(write = writes.at(-1)) { const kind = write.ref.path.split('/').at(-2), id = write.ref.path.split('/').at(-1); const next = collections[kind].filter(value => (value.itemId || value.uid) !== id); if (write.operation === 'set') next.push({ ...write.value, createdAt: timestamp, confirmedAt: timestamp }); emit(kind, next); write.result.resolve(); await flush(); }
  render();
  return { button, nodes, writes, emit, flush, commit, auth, text: () => textOf(tree), render, local, setProps(next) { props = { ...props, ...next }; render(); }, unmount() { unmounted = true; slots.forEach(slot => slot?.cleanup?.()); } };
}

test('real confirmation handler writes only own identity/hash and blocks duplicate sends until acknowledged', async () => {
  const h = harness({ requirements: [requirement('passport')] }); await h.flush();
  const confirm = h.button('I am ready to depart'); assert.equal(confirm.props.disabled, false);
  confirm.props.onClick(); confirm.props.onClick(); h.render();
  assert.equal(h.writes.length, 1); const write = h.writes[0];
  assert.equal(write.ref.path, 'packingTrips/one/departureConfirmations/alice');
  assert.deepEqual(Object.keys(write.value).sort(), ['confirmedAt', 'contextHash', 'memberId', 'uid']);
  assert.equal(write.value.uid, 'alice'); assert.equal(write.value.memberId, 'a'); assert.match(write.value.contextHash, /^[a-f0-9]{64}$/);
  assert.equal(h.text().includes('Everyone is ready to depart'), false);
  await h.commit(write); assert.ok(h.button('Undo my readiness confirmation')); h.unmount();
});

test('real handlers enforce organizer requirement editing and own-account confirmation eligibility', async () => {
  const h = harness(); await h.flush();
  const checks = h.nodes().filter(node => node?.type === 'input' && node.props.type === 'checkbox');
  checks[0].props.onChange(); h.render(); assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].ref.path, 'packingTrips/one/departureRequirements/passport');
  assert.deepEqual(Object.keys(h.writes[0].value).sort(), ['createdAt', 'createdBy', 'itemId']);
  await h.commit(); assert.equal(h.nodes().filter(node => node?.type === 'input' && node.props.type === 'checkbox')[0].props.checked, true);
  h.setProps({ uid: 'outsider' }); h.auth.currentUser.uid = 'outsider'; await h.flush();
  assert.equal(h.nodes().some(node => node?.type === 'input' && node.props.type === 'checkbox'), false);
  assert.equal(h.nodes().some(node => node?.type === 'button' && node.props.children === 'I am ready to depart'), false); h.unmount();
});

test('cached or unacknowledged snapshots and incomplete shared essentials prevent confirmation', async () => {
  const h = harness({ requirements: [requirement('ticket')] }); await h.flush();
  h.emit('departureRequirements', [requirement('ticket')], { fromCache: true }); await h.flush();
  assert.equal(h.button('I am ready to depart').props.disabled, true);
  h.emit('departureRequirements', [requirement('ticket')], { hasPendingWrites: true }); await h.flush();
  assert.equal(h.button('I am ready to depart').props.disabled, true);
  h.emit('departureRequirements', [requirement('ticket')]); await h.flush();
  assert.equal(h.button('I am ready to depart').props.disabled, false);
  const data = packingData(); data.assignments.find(row => row.id === 'ticket_unit_2').memberId = '';
  h.setProps({ packing: { data, cloud: true, loaded: true, synced: true, busy: false } }); await h.flush();
  assert.equal(h.button('I am ready to depart').props.disabled, true); h.unmount();
});

test('failed save preserves draft requirement choice and old-scope failures cannot affect current trip', async () => {
  const h = harness(); await h.flush(); h.button('I am ready to depart').props.onClick(); h.render();
  const old = h.writes[0]; h.setProps({ scope: 'two' }); await h.flush();
  old.result.reject(Object.assign(new Error('SECRET'), { code: 'permission-denied' })); await h.flush();
  assert.equal(h.text().includes('access denied'), false); assert.equal(h.text().includes('SECRET'), false);
  h.button('I am ready to depart').props.onClick(); h.render();
  const latest = h.writes[1]; assert.equal(latest.ref.path, 'packingTrips/two/departureConfirmations/alice');
  latest.result.reject(Object.assign(new Error('SECRET'), { code: 'unavailable' })); await h.flush();
  assert.ok(h.text().includes('Check your connection')); assert.equal(h.button('I am ready to depart').props.disabled, false); h.unmount();
});

test('source packing must be server-synced before any readiness badge or confirmation is active', async () => {
  const data = packingData();
  const hashes = Object.fromEntries(await Promise.all(data.members.map(async member => [member.id, await lib.hashReadinessContext(lib.readinessContext(data, [], member.id, 'one'))])));
  const h = harness({ confirmations: confirmations(hashes) }); await h.flush();
  assert.ok(h.text().includes('Everyone is ready to depart'));
  h.setProps({ packing: { data, loaded: true, synced: false, cloud: true, busy: false } }); await h.flush();
  assert.equal(h.text().includes('Everyone is ready to depart'), false);
  assert.equal(h.nodes().filter(node => node?.props?.className === 'departure-member-status is-ready').length, 0);
  assert.equal(h.button('Undo my readiness confirmation').props.disabled, true); h.unmount();
});

test('local demo persists only this device and read-only or local storage failure cannot report ready', async () => {
  const h = harness({ cloud: false }); await h.flush(); h.button('I am ready to depart').props.onClick(); await h.flush();
  const stored = JSON.parse(h.local.get('motteku-departure-v1:one')); assert.equal(stored.confirmations[0].uid, 'alice');
  assert.ok(h.text().includes('this device only')); assert.equal(h.writes.length, 0);
  h.setProps({ readOnly: true }); assert.equal(h.button('Undo my readiness confirmation').props.disabled, true); h.unmount();
  const failed = harness({ cloud: false, localFailure: true }); await failed.flush(); failed.button('I am ready to depart').props.onClick(); await failed.flush();
  assert.ok(failed.text().includes('Could not save departure readiness')); assert.equal(failed.text().includes('SECRET'), false); failed.unmount();
});
