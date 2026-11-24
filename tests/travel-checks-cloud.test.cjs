const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

function cloudApp(options = {}) {
  const slots = [], effects = [], modules = new Map(), authObservers = new Set(), subscriptions = new Set();
  const reads = [], writes = [], diagnostics = [], consoleErrors = [];
  let cursor = 0, dirty = true, requestedUid = 'owner', scope = options.scope || 'owner_trip';
  const auth = { currentUser: options.authUid === null ? null : { uid: options.authUid || 'owner' } };
  const database = { app: { options: { projectId: 'demo-motteku' } } };
  const documents = new Map();
  const parent = `packingTrips/${scope}`;
  if (options.parentExists !== false) documents.set(parent, { ownerUid: 'owner', sourceTripId: 'trip', roomId: '', adminUids: [], bagIds: ['blue'] });
  const errors = new Map(options.errors || []);
  const snapshot = ref => ({ exists: () => documents.has(ref.path), data: () => documents.get(ref.path), metadata: { hasPendingWrites: false } });
  function deliver(subscription) {
    if (!subscriptions.has(subscription)) return;
    const failure = errors.get(subscription.ref.path);
    if (failure) { subscription.fail(failure); return; }
    if (subscription.ref.collection) {
      const prefix = `${subscription.ref.path}/`;
      subscription.next({ docs: [...documents].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(([key]) => snapshot({ path: key })), metadata: { hasPendingWrites: false } });
    } else subscription.next(snapshot(subscription.ref));
  }
  const firestore = {
    ...require('firebase/firestore'),
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    collection: (_db, ...parts) => ({ path: parts.join('/'), collection: true }),
    async getDocFromServer(ref) { reads.push({ operation: 'get-parent', path: ref.path }); if (options.parentDelay) await options.parentDelay; if (errors.has(ref.path)) throw errors.get(ref.path); return snapshot(ref); },
    onSnapshot(ref, _options, next, fail) { reads.push({ operation: 'listen', path: ref.path }); const subscription = { ref, next, fail }; subscriptions.add(subscription); queueMicrotask(() => deliver(subscription)); return () => subscriptions.delete(subscription); },
    async runTransaction(_db, action) {
      const pending = [];
      await action({ get: async ref => snapshot(ref), set(ref, data) { pending.push([ref.path, data]); } });
      for (const [key, data] of pending) { documents.set(key, data); writes.push({ path: key, data }); }
      for (const subscription of subscriptions) queueMicrotask(() => deliver(subscription));
    },
  };
  const react = {
    useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { const next = typeof value === 'function' ? value(slots[key]) : value; if (next !== slots[key]) { slots[key] = next; dirty = true; } }]; },
    useRef(initial) { const key = cursor++; if (!(key in slots)) slots[key] = { current: initial }; return slots[key]; },
    useEffect(fn, deps) { const key = cursor++, old = slots[key]; if (!old || deps.some((value, i) => old.deps[i] !== value)) { old?.cleanup?.(); slots[key] = { deps }; effects.push(() => { slots[key].cleanup = fn(); }); } },
  };
  function load(file) {
    file = path.resolve(__dirname, '..', file);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', code)(exports, name => {
      if (name === 'react') return react;
      if (name === './firebase') return { auth, db: database };
      if (name === 'firebase/firestore') return firestore;
      if (name === 'firebase/auth') return { onAuthStateChanged(_auth, callback) { authObservers.add(callback); queueMicrotask(() => { if (authObservers.has(callback)) callback(auth.currentUser); }); return () => authObservers.delete(callback); } };
      return name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
    });
    return exports;
  }
  const { useTravelChecks } = load('lib/useTravelChecks.ts');
  const packing = { cloud: true, loaded: options.packingLoaded !== false, busy: false, data: { ownerUid: 'owner', adminUids: [], bags: [{ id: 'blue', name: 'Blue bag' }], members: [{ id: 'm1', uid: 'owner', name: 'Hnin' }], items: [{ id: 'shoes', tripId: 'trip', name: 'Shoes', type: 'personal', quantity: 1, targetMemberIds: ['m1'] }], assignments: [{ id: 'shoes_m1', tripId: 'trip', itemId: 'shoes', memberId: 'm1', status: 'packed', bagId: 'blue' }] } };
  let current;
  async function capture(action) {
    const warn = console.warn, error = console.error;
    console.warn = (...args) => diagnostics.push(args); console.error = (...args) => consoleErrors.push(args);
    try { return await action(); } finally { console.warn = warn; console.error = error; }
  }
  async function render() {
    return capture(async () => {
      for (let i = 0; i < 30; i++) {
        dirty = false; cursor = 0;
        current = useTravelChecks(scope, 'trip', requestedUid, packing, { startDate: '2026-11-20', endDate: '2026-11-24', ...options.trip });
        while (effects.length) effects.shift()();
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty) return current;
      }
      throw new Error('Cloud hook did not settle');
    });
  }
  return { render, reads, writes, documents, errors, diagnostics, consoleErrors, packing, parent, get current() { return current; },
    async act(action) { return capture(async () => { const result = await action(current); await render(); return result; }); },
    async authenticate(uid) { auth.currentUser = uid ? { uid } : null; for (const callback of authObservers) callback(auth.currentUser); return render(); },
    async requestUid(uid) { requestedUid = uid; return render(); },
    async changeScope(value) { scope = value; return render(); },
  };
}

for (const description of ['newly created trip', 'existing trip with no travel-check fields']) test(`${description}: empty snapshots load normally without implicit writes`, async () => {
  const app = cloudApp(); await app.render();
  assert.equal(app.current.loaded, true); assert.equal(app.current.readyForWrites, true);
  assert.deepEqual(app.current.checks, []); assert.equal(app.current.plan.accommodationMode, 'single'); assert.deepEqual(app.current.plan.stays, []);
  assert.equal(app.current.availableChecks[0].id, 'return-home');
  assert.equal(app.current.error, ''); assert.equal(app.writes.length, 0); assert.equal(app.diagnostics.length, 0); assert.equal(app.consoleErrors.length, 0);
  assert.deepEqual(app.reads.map(read => read.path), [app.parent, `${app.parent}/travelCheckpoints`, `${app.parent}/travelCheckPlans/current`]);
});

test('start explicitly creates only the requested snapshot; retrying or refreshing never creates extra records', async () => {
  const app = cloudApp(); await app.render();
  assert.equal(await app.act(c => c.start('return-home')), true);
  assert.equal(app.writes.length, 1); assert.equal(app.writes[0].path, `${app.parent}/travelCheckpoints/return-home`);
  assert.equal(app.current.checks[0].items.length, 1); assert.equal(app.current.checks[0].status, 'inProgress');
  await app.act(c => c.retry());
  assert.equal(app.current.checks.length, 1); assert.equal(app.writes.length, 1);
  await app.act(c => c.start('return-home')); assert.equal(app.writes.length, 1);
});

test('saving a plan is the other explicit creation action', async () => {
  const app = cloudApp(); await app.render();
  assert.equal(await app.act(c => c.savePlan(c.plan)), true);
  assert.deepEqual(app.writes.map(write => write.path).sort(), [`${app.parent}/travelCheckPlans/current`, `${app.parent}/travelCheckpoints/return-home`].sort());
});

test('packing.loaded alone cannot start listeners when Firebase auth is missing or belongs to another UID', async () => {
  const app = cloudApp({ authUid: null }); await app.render();
  assert.equal(app.current.loaded, false); assert.equal(app.reads.length, 0);
  await app.authenticate('different-user'); assert.equal(app.reads.length, 0);
  await app.authenticate('owner'); assert.equal(app.current.loaded, true); assert.equal(app.reads.length, 3);
  await app.authenticate(null); assert.equal(app.current.loaded, false); assert.deepEqual(app.current.checks, []);
  assert.equal(await app.act(c => c.start('return-home')), false); assert.equal(app.writes.length, 0);
});

test('a missing parent is a recoverable empty state, and retry waits for the actual parent to exist', async () => {
  const app = cloudApp({ parentExists: false }); await app.render();
  assert.deepEqual(app.current.checks, []); assert.equal(app.current.loaded, true); assert.equal(app.current.readyForWrites, false);
  assert.equal(app.reads.length, 1); assert.equal(app.consoleErrors.length, 0);
  assert.equal(await app.act(c => c.start('return-home')), false); assert.equal(app.writes.length, 0);
  app.documents.set(app.parent, { ownerUid: 'owner' }); await app.act(c => c.retry());
  assert.equal(app.current.readyForWrites, true); assert.equal(app.current.error, ''); assert.equal(app.writes.length, 0);
});

for (const suffix of ['travelCheckpoints', 'travelCheckPlans/current']) test(`denied ${suffix} read exposes full diagnostics and a recoverable notice without console.error`, async () => {
  const path = `packingTrips/owner_trip/${suffix}`;
  const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const app = cloudApp({ errors: [[path, failure]] }); await app.render();
  assert.match(app.current.error, /access was denied/); assert.equal(app.current.loaded, false);
  assert.equal(app.consoleErrors.length, 0); assert.equal(app.writes.length, 0);
  const info = app.diagnostics.find(([, detail]) => detail.documentPath === path)[1];
  assert.equal(info.code, 'permission-denied'); assert.equal(info.message, failure.message);
  assert.equal(info.currentUserUid, 'owner'); assert.equal(info.requestedUid, 'owner'); assert.equal(info.tripId, 'trip'); assert.equal(info.packingScope, 'owner_trip'); assert.equal(info.projectId, 'demo-motteku');
  app.errors.delete(path); await app.act(c => c.retry());
  assert.equal(app.current.loaded, true); assert.equal(app.current.error, ''); assert.deepEqual(app.current.checks, []); assert.equal(app.writes.length, 0);
});

test('a delayed parent read cannot attach old listeners after auth changes or a trip switch', async () => {
  let release; const parentDelay = new Promise(resolve => { release = resolve; });
  const app = cloudApp({ parentDelay }); await app.render();
  await app.authenticate('different-user'); release(); await app.render();
  assert.equal(app.reads.filter(read => read.operation === 'listen').length, 0);
  assert.equal(app.current.loaded, false); assert.equal(app.writes.length, 0);
});
