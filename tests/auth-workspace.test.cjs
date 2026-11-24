const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Run the actual page's auth/subscription/save effects with controlled Firebase I/O.
const pageText = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
const page = ts.createSourceFile('page.tsx', pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = page.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Home');
assert.ok(home?.body, 'Dashboard component exists');
const effectCalls = home.body.statements.filter(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(page) === 'useEffect').map(node => node.expression);
const effects = ['onAuthStateChanged', 'onSnapshot(ref', 'setDoc(ref'].map(text => {
  const matches = effectCalls.filter(node => node.arguments[0].getText(page).includes(text));
  assert.equal(matches.length, 1, `Actual page effect: ${text}`);
  return { callback: matches[0].arguments[0].getText(page), deps: matches[0].arguments[1].getText(page) };
});
function initializer(name) {
  for (const statement of home.body.statements) if (ts.isVariableStatement(statement)) {
    const found = statement.declarationList.declarations.find(node => node.name.getText(page) === name);
    if (found) return found.initializer.getText(page);
  }
  throw new Error(`Missing page expression: ${name}`);
}
function evaluate(expression, context) {
  const code = ts.transpileModule('module.exports = ' + expression, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: undefined };
  new Function('module', ...Object.keys(context), code)(module, ...Object.values(context));
  return module.exports;
}
const workspace = (owner, id = owner + '-trip') => ({ activeTripId: id, trips: [{ id, name: owner + ' private trip' }], history: [], owner });
const user = uid => ({ uid, isAnonymous: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(config = {}) {
  const seed = workspace('starter');
  const state = { user: null, workspace: seed, workspaceUid: '', ready: false, remoteLoaded: false, remoteError: false, notice: '' };
  const auth = { currentUser: null };
  const storage = new Map(Object.entries(config.storage || {}));
  const storageReads = [], storageWrites = [], writes = [], listeners = [], authListeners = [], routes = [];
  const slots = [], queue = [];
  let dirty = false, output, unmounted = false;
  const setter = key => value => {
    const next = typeof value === 'function' ? value(state[key]) : value;
    if (!Object.is(next, state[key])) { state[key] = next; dirty = true; }
  };
  const router = { replace: destination => routes.push(destination) };
  const base = {
    seed, auth, db: config.noDb ? null : {}, firebaseConfigured: config.configured !== false, router,
    window: { location: { pathname: '/', search: '?trip=shared' } },
    normalizeWorkspace: value => value,
    localStorage: {
      getItem(key) { storageReads.push(key); return storage.get(key) || null; },
      setItem(key, value) { storageWrites.push({ key, value }); storage.set(key, value); },
    },
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    onAuthStateChanged(_auth, next) {
      const listener = { next, active: true }; authListeners.push(listener);
      return () => { listener.active = false; };
    },
    onSnapshot(ref, next, fail) {
      const listener = { ref, next, fail, active: true }; listeners.push(listener);
      return () => { listener.active = false; };
    },
    setDoc(ref, data, options) {
      const result = deferred();
      writes.push({ ref, data: structuredClone(data), options, result });
      if (!config.deferWrites) result.resolve();
      return result.promise;
    },
    setUser: setter('user'), setWorkspace: setter('workspace'), setWorkspaceUid: setter('workspaceUid'),
    setReady: setter('ready'), setRemoteLoaded: setter('remoteLoaded'), setRemoteError: setter('remoteError'), setNotice: setter('notice'),
  };
  function render(complete = true) {
    if (unmounted) return;
    let turns = 0;
    do {
      assert.ok(++turns < 30, 'Effects settle without a render loop');
      dirty = false;
      const context = { ...base, ...state, active: state.workspace.trips.find(trip => trip.id === state.workspace.activeTripId) || state.workspace.trips[0] };
      context.packingUid = evaluate(initializer('packingUid'), context);
      context.workspaceReady = evaluate(initializer('workspaceReady'), context);
      output = { workspaceReady: context.workspaceReady, packingScope: evaluate(initializer('packingScope'), context) };
      effects.forEach((effect, index) => {
        const deps = evaluate(effect.deps, context), previous = slots[index];
        if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) queue.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: evaluate(effect.callback, context)() };
        });
      });
      if (complete) while (queue.length) queue.shift()();
    } while (dirty && complete);
  }
  const active = uid => listeners.filter(listener => listener.active && listener.ref.path === `users/${uid}/workspace/main`).at(-1);
  function authenticate(next, complete = true) {
    auth.currentUser = next;
    authListeners.filter(listener => listener.active).at(-1).next(next);
    render(complete);
  }
  function emit(uid, data) { const listener = active(uid); assert.ok(listener, 'Workspace subscription for ' + uid); listener.next({ exists: () => data !== null, data: () => data }); render(); }
  async function flush() { for (let turn = 0; turn < 5; turn++) { await Promise.resolve(); render(); } }
  render();
  return {
    state, auth, writes, listeners, routes, storage, storageReads, storageWrites, active, authenticate, emit, flush,
    get output() { return output; },
    completeEffects() { while (queue.length) queue.shift()(); render(); },
    fail(uid) { active(uid).fail(new Error('permission-denied')); render(); },
    edit(data) { setter('workspace')(data); render(); },
    unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('signed-out and anonymous users are redirected without opening or writing a workspace', () => {
  for (const value of [null, { uid: 'guest', isAnonymous: true }]) {
    const h = harness(); h.authenticate(value);
    assert.match(h.routes.at(-1), /^\/login\?next=/);
    assert.equal(h.listeners.length, 0); assert.equal(h.writes.length, 0);
    assert.equal(h.output.workspaceReady, false); assert.equal(h.output.packingScope, ''); h.unmount();
  }
  const unavailable = harness({ configured: false });
  assert.equal(unavailable.routes.at(-1), '/login');
  assert.equal(unavailable.listeners.length, 0); assert.equal(unavailable.writes.length, 0); unavailable.unmount();
});

test('switching accounts cannot write or initialize packing from the previous account before the new load', () => {
  const h = harness(); h.authenticate(user('alice')); h.emit('alice', workspace('alice'));
  assert.equal(h.writes.at(-1).ref.path, 'users/alice/workspace/main');
  const before = h.writes.length;
  h.authenticate(user('bob'), false);
  assert.equal(h.output.workspaceReady, false);
  assert.equal(h.output.packingScope, '', 'No Bob packing parent can be initialized using Alice trip data');
  h.completeEffects();
  assert.equal(h.writes.length, before, 'Bob is not written until his own snapshot arrives');
  h.emit('bob', workspace('bob'));
  const bobWrites = h.writes.filter(write => write.ref.path === 'users/bob/workspace/main');
  assert.equal(bobWrites.length, 1); assert.equal(bobWrites[0].data.owner, 'bob');
  assert.equal(h.output.packingScope, 'bob_bob-trip'); h.unmount();
});

test('late snapshots and errors from a previous account are ignored before and after cleanup', () => {
  const h = harness(); h.authenticate(user('alice')); h.emit('alice', workspace('alice'));
  const old = h.active('alice');
  h.authenticate(user('bob'), false);
  old.next({ exists: () => true, data: () => workspace('stale-before-cleanup') });
  old.fail(new Error('old error'));
  assert.equal(h.state.workspace.owner, 'alice'); assert.equal(h.state.remoteError, false);
  h.completeEffects(); h.emit('bob', workspace('bob'));
  old.next({ exists: () => true, data: () => workspace('stale-after-cleanup') }); old.fail(new Error('old error'));
  assert.equal(h.state.workspace.owner, 'bob'); assert.equal(h.state.remoteError, false);
  assert.equal(h.writes.filter(write => write.data.owner.startsWith('stale')).length, 0); h.unmount();
});

test('offline fallback reads and updates only the signed-in account backup and never a legacy shared backup', () => {
  const h = harness({ storage: {
    'motteku-workspace': JSON.stringify(workspace('legacy-alice')),
    'motteku-workspace:alice': JSON.stringify(workspace('alice')),
    'motteku-workspace:bob': JSON.stringify(workspace('bob-backup')),
  } });
  h.authenticate(user('bob')); h.fail('bob');
  assert.equal(h.state.workspace.owner, 'bob-backup');
  assert.deepEqual(h.storageReads, ['motteku-workspace:bob']);
  assert.equal(h.writes.length, 0, 'Permission failure does not attempt a cloud overwrite');
  h.edit(workspace('bob-edited'));
  assert.equal(JSON.parse(h.storage.get('motteku-workspace:bob')).owner, 'bob-edited');
  assert.equal(JSON.parse(h.storage.get('motteku-workspace:alice')).owner, 'alice');
  assert.equal(JSON.parse(h.storage.get('motteku-workspace')).owner, 'legacy-alice');
  assert.ok(h.storageWrites.every(write => write.key === 'motteku-workspace:bob')); h.unmount();
});

test('a missing new-account document cannot inherit the previous account workspace', () => {
  const h = harness(); h.authenticate(user('alice')); h.emit('alice', workspace('alice'));
  h.authenticate(user('bob')); h.emit('bob', null);
  assert.equal(h.state.workspace.owner, 'starter');
  const bob = h.writes.filter(write => write.ref.path === 'users/bob/workspace/main');
  assert.equal(bob.length, 1); assert.equal(bob[0].data.owner, 'starter'); h.unmount();
});

test('a delayed save failure from the previous account cannot mark the new account as failed', async () => {
  const h = harness({ deferWrites: true });
  h.authenticate(user('alice')); h.emit('alice', workspace('alice'));
  const aliceWrite = h.writes.at(-1);
  h.authenticate(user('bob')); h.emit('bob', workspace('bob'));
  aliceWrite.result.reject(new Error('delayed old-account rejection'));
  await h.flush();
  assert.equal(h.state.remoteError, false); assert.equal(h.state.notice, '');
  assert.equal(h.state.workspace.owner, 'bob');
  for (const write of h.writes) if (write !== aliceWrite) write.result.resolve();
  await h.flush(); h.unmount();
});
