const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the actual hook and subscription callbacks without contacting Firebase.
const filename = path.join(__dirname, '../lib/usePacking.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sourceNames = ['parent', 'members', 'items', 'itemAssignments'];
const serverMetadata = { fromCache: false, hasPendingWrites: false };

function harness(config = {}) {
  let props = { scope: 'one', sourceTripId: 'trip-one', roomId: '', uid: 'alice', members: [{ id: 'a', name: 'Me' }], bags: [], ...config.props };
  let index = 0, dirty = false, unmounted = false, afterUnmount = 0, output;
  const slots = [], effects = [], listeners = [], reads = [], transactions = [];
  const react = {
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { if (unmounted) { afterUnmount++; return; } slots[at] = typeof value === 'function' ? value(slots[at]) : value; dirty = true; }]; },
    useRef(initial) { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(effect, deps) { const at = index++, old = slots[at]; if (!old || deps.some((value, position) => !Object.is(value, old.deps[position]))) effects.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: effect() }; }); },
  };
  const reference = (...parts) => ({ path: parts.map(part => typeof part === 'string' ? part : part?.path || '').filter(Boolean).join('/') });
  function snapshot(kind, metadata = serverMetadata, value) {
    return kind === 'parent'
      ? { data: () => value === undefined ? { ownerUid: 'alice', adminUids: [], bags: [] } : value, metadata }
      : { docs: (value || []).map(data => ({ id: data.id, data: () => data })), metadata };
  }
  const firestore = {
    doc: reference, collection: reference, serverTimestamp: () => 'SERVER_TIMESTAMP',
    getDoc(ref) {
      const result = deferred(); reads.push({ ref, result });
      if (!config.deferReads) result.resolve({ exists: () => true, data: () => ({ ownerUid: 'alice' }) });
      return result.promise;
    },
    onSnapshot(ref, ...args) {
      const [metadata, next, fail] = typeof args[0] === 'function' ? [null, ...args] : args;
      const kind = ref.path.split('/').length === 2 ? 'parent' : ref.path.split('/').at(-1);
      const listener = { ref, kind, metadata, next, fail, active: true }; listeners.push(listener);
      if (config.autoSnapshots) next(snapshot(kind, config.initialMetadata || serverMetadata));
      return () => { listener.active = false; };
    },
    async runTransaction(_db, action) { const writes = []; transactions.push(writes); await action({ get: async () => ({ exists: () => false }), set: (...args) => writes.push(args) }); },
    writeBatch() { return { commit: async () => {} }; },
  };
  const exported = { exports: {} };
  function load(name) {
    if (name === 'react') return react;
    if (name === 'firebase/firestore') return firestore;
    if (name === './firebase') return { db: config.noDb ? null : {}, firebaseConfigured: config.cloud !== false };
    if (name === './messages') return { errorKey: (_error, fallback) => fallback };
    if (name === './packing') return { restorePackingData: value => value };
    throw new Error('Unexpected import: ' + name);
  }
  vm.runInNewContext(source, { module: exported, exports: exported.exports, require: load, localStorage: { getItem: () => { if (config.localError) throw new Error('private local details'); return config.localValue || null; }, setItem() {} } }, { filename });
  function runEffects() { while (effects.length) effects.shift()(); }
  function render(complete = true) { if (unmounted) return; let turns = 0; do { if (++turns > 30) throw new Error('Render loop'); dirty = false; index = 0; output = exported.exports.usePacking(props.scope, props.sourceTripId, props.roomId, props.uid, props.members, props.bags); if (complete) runEffects(); } while (dirty && complete); }
  async function flush() { for (let turn = 0; turn < 10; turn++) { await Promise.resolve(); render(); } }
  const active = kind => listeners.filter(listener => listener.active && listener.kind === kind).at(-1);
  function emit(kind, metadata = serverMetadata, value) { const listener = active(kind); assert.ok(listener, 'Missing listener: ' + kind); listener.next(snapshot(kind, metadata, value)); render(); }
  render();
  return {
    listeners, reads, transactions, flush, emit, snapshot, active, get output() { return output; }, get afterUnmount() { return afterUnmount; },
    setProps(next, complete = true) { props = { ...props, ...next }; render(complete); },
    completeEffects() { runEffects(); render(); },
    unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('packing is loaded from cached snapshots but synced waits for all four server sources', async () => {
  const h = harness(); await h.flush();
  assert.equal(h.output.loaded, false); assert.equal(h.output.synced, false);
  assert.equal(h.listeners.length, 4);
  for (const listener of h.listeners) assert.equal(listener.metadata.includeMetadataChanges, true);
  for (const kind of sourceNames) h.emit(kind, { fromCache: true, hasPendingWrites: false });
  assert.equal(h.output.loaded, true, 'Existing cached packing still renders');
  assert.equal(h.output.synced, false, 'Cached packing must never authorize readiness');
  for (const kind of sourceNames.slice(0, -1)) { h.emit(kind); assert.equal(h.output.synced, false); }
  h.emit('itemAssignments'); assert.equal(h.output.synced, true); h.unmount();
});

test('metadata-only pending/cache changes from any source immediately suspend synced and recover on acknowledgement', async () => {
  const h = harness({ autoSnapshots: true }); await h.flush(); assert.equal(h.output.synced, true);
  for (const kind of sourceNames) {
    h.emit(kind, { fromCache: false, hasPendingWrites: true }); assert.equal(h.output.synced, false, kind + ' pending write'); assert.equal(h.output.loaded, true);
    h.emit(kind); assert.equal(h.output.synced, true, kind + ' acknowledged');
    h.emit(kind, { fromCache: true, hasPendingWrites: false }); assert.equal(h.output.synced, false, kind + ' offline cache');
    h.emit(kind); assert.equal(h.output.synced, true);
  }
  h.unmount();
});

test('source scope and UID changes invalidate sync before effects run and reject late old callbacks', async () => {
  for (const next of [{ scope: 'two' }, { uid: 'bob' }]) {
    const h = harness({ autoSnapshots: true }); await h.flush(); const old = [...h.listeners]; assert.equal(h.output.synced, true);
    h.setProps(next, false); assert.equal(h.output.synced, false, 'Render must not expose an old identity as synced');
    old[0].next(h.snapshot('parent', serverMetadata, { ownerUid: 'stale-owner' })); old[0].fail(new Error('old failure'));
    h.completeEffects(); await h.flush(); assert.equal(h.output.synced, true); assert.equal(h.output.data.ownerUid, 'alice'); assert.equal(h.output.error, '');
    assert.ok(old.every(listener => !listener.active)); h.unmount();
  }
});

test('a listener failure or deleted parent clears synced even after prior server confirmation', async () => {
  const h = harness({ autoSnapshots: true }); await h.flush(); assert.equal(h.output.synced, true);
  h.active('items').fail(new Error('private server detail')); await h.flush();
  assert.equal(h.output.synced, false); assert.equal(h.output.loaded, false); assert.doesNotMatch(h.output.error, /private server detail/);
  h.emit('members'); assert.equal(h.output.synced, false, 'Another live listener cannot conceal a failed source'); h.unmount();
  const removed = harness({ autoSnapshots: true }); await removed.flush(); removed.emit('parent', serverMetadata, null); assert.equal(removed.output.synced, false); assert.equal(removed.output.loaded, false); removed.unmount();
});

test('late initial reads and callbacks after unmount cannot subscribe or publish old packing data', async () => {
  const h = harness({ deferReads: true }); assert.equal(h.reads.length, 1);
  h.setProps({ scope: 'two' }); assert.equal(h.reads.length, 2);
  h.reads[0].result.resolve({ exists: () => true }); await h.flush(); assert.equal(h.listeners.length, 0);
  h.reads[1].result.resolve({ exists: () => true }); await h.flush(); assert.equal(h.listeners.length, 4); assert.ok(h.listeners.every(listener => listener.ref.path.startsWith('packingTrips/two')));
  h.unmount(); for (const listener of h.listeners) { listener.next(h.snapshot(listener.kind)); listener.fail(new Error('late')); }
  await h.flush(); assert.equal(h.afterUnmount, 0); assert.ok(h.listeners.every(listener => !listener.active));
  const unmountedRead = harness({ deferReads: true }); unmountedRead.unmount(); unmountedRead.reads[0].result.resolve({ exists: () => true }); await unmountedRead.flush(); assert.equal(unmountedRead.listeners.length, 0);
});

test('changing scope during room-owner bootstrap prevents a stale initialization transaction', async () => {
  const h = harness({ deferReads: true, props: { roomId: 'old-room' } });
  h.reads[0].result.resolve({ exists: () => false }); await h.flush(); assert.equal(h.reads[1].ref.path, 'sharedTrips/old-room');
  h.setProps({ scope: 'two', roomId: 'new-room' });
  h.reads[1].result.resolve({ exists: () => true, data: () => ({ ownerUid: 'alice' }) }); await h.flush();
  assert.equal(h.transactions.length, 0); assert.equal(h.listeners.length, 0); h.unmount();
});

test('local loaded data is synced without cloud listeners; missing identity, setup or local failures remain unsynced', async () => {
  const local = harness({ cloud: false }); assert.equal(local.output.loaded, true); assert.equal(local.output.synced, true); assert.equal(local.listeners.length, 0); assert.equal(local.reads.length, 0); local.unmount();
  for (const config of [{ cloud: false, localError: true }, { cloud: false, localValue: 'broken json' }, { props: { scope: '' } }, { props: { uid: '' } }, { noDb: true }]) {
    const h = harness(config); await h.flush(); assert.equal(h.output.synced, false); assert.equal(h.listeners.length, 0); assert.doesNotMatch(h.output.error, /private local details/); h.unmount();
  }
});
