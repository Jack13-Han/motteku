const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'components/AuthForm.tsx'), 'utf8');
const textOf = node => Array.isArray(node) ? node.map(textOf).join(' ') : node && typeof node === 'object' ? textOf(node.props?.children) : node == null ? '' : String(node);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const calls = [], redirects = [], timers = new Map(), slots = [], effects = [];
  const auth = { currentUser: options.user || null, languageCode: null };
  const local = { kind: 'local' }, session = { kind: 'session' };
  let observer, index = 0, dirty = false, tree, timerId = 0, focusCount = 0, pending = [];
  const router = { replace: value => redirects.push(value) };
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], value => {
        const next = typeof value === 'function' ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; }
      }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useEffect(fn, dependencies) {
      const slot = index++, before = effects[slot];
      if (!before || dependencies.some((value, n) => !Object.is(value, before.dependencies[n]))) pending.push({ slot, fn, dependencies });
    },
  };
  const sdk = {
    browserLocalPersistence: local, browserSessionPersistence: session,
    onAuthStateChanged(_auth, callback) { observer = callback; callback(auth.currentUser); return () => { observer = null; }; },
    async setPersistence(_auth, persistence) { calls.push({ type: 'persistence', persistence }); if (options.persistence) await options.persistence(); },
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    async signInWithEmailAndPassword(_auth, email, password) {
      calls.push({ type: 'login', email, password });
      auth.currentUser = { uid: 'account', isAnonymous: false }; observer?.(auth.currentUser);
    },
    async createUserWithEmailAndPassword(_auth, email, password) {
      calls.push({ type: 'register', email, password });
      auth.currentUser = { uid: 'new-account', isAnonymous: false }; observer?.(auth.currentUser);
      return { user: auth.currentUser };
    },
    async linkWithCredential(user, credential) {
      calls.push({ type: 'link', uid: user.uid, credential });
      auth.currentUser = { ...user, isAnonymous: false }; observer?.(auth.currentUser);
      return { user: auth.currentUser };
    },
    async updateProfile(user, profile) { calls.push({ type: 'profile', uid: user.uid, profile }); if (options.profile) await options.profile(); },
    async sendPasswordResetEmail(_auth, email) { calls.push({ type: 'reset', email, language: auth.languageCode }); if (options.reset) await options.reset(); },
  };
  const window = {
    location: { search: options.search || '' },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const jsx = (type, props) => {
    if (props?.ref && type === 'input') props.ref.current = { focus() { focusCount++; } };
    return { type, props: props || {} };
  };
  const tripExports = {};
  const tripSource = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/trips.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', tripSource)(tripExports, require);
  const stubs = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/link': { default: 'link' }, 'next/navigation': { useRouter: () => router },
    'firebase/auth': sdk, 'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
    '@/lib/firebase': { auth, firebaseConfigured: options.configured !== false },
    '@/lib/i18n': { useLanguage: () => ({ language: options.language || 'ja', t: value => value }) },
    '@/lib/trips': tripExports,
  };
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', 'window', compiled)(exports, name => { if (!(name in stubs)) throw Error('Unexpected import ' + name); return stubs[name]; }, window);
  function render() {
    let rounds = 0;
    do {
      if (++rounds > 20) throw Error('Render did not stabilize');
      dirty = false; index = 0; pending = [];
      tree = exports.default({ mode: options.mode || 'login' });
      for (const effect of pending) {
        effects[effect.slot]?.cleanup?.();
        effects[effect.slot] = { dependencies: effect.dependencies, cleanup: effect.fn() };
      }
    } while (dirty);
    return tree;
  }
  function nodes() {
    const result = [];
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; result.push(node); visit(node.props?.children); };
    visit(tree); return result;
  }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, 'Expected rendered control exists'); return node; };
  function change(autoComplete, value) {
    find(node => node.type === 'input' && node.props.autoComplete === autoComplete).props.onChange({ target: { value } }); render();
  }
  function remember(value) { find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: value } }); render(); }
  const submit = () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); render(); };
  const reset = () => { find(node => node.type === 'button' && node.props.className === 'auth-forgot').props.onClick(); return settle(); };
  const fire = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } render(); };
  const cleanup = () => effects.forEach(effect => effect?.cleanup?.());
  render();
  return { auth, calls, redirects, local, session, render, nodes, find, change, remember, submit, reset, settle, fire, cleanup, text: () => textOf(tree), focusCount: () => focusCount, emitAuth: user => { auth.currentUser = user; observer?.(user); render(); } };
}

test('remember me selects local or session persistence before email sign-in', async () => {
  for (const checked of [true, false]) {
    const ui = harness({ search: '?next=%2Ftrips' });
    ui.change('email', '  han@example.test  '); ui.change('current-password', 'password'); ui.remember(checked);
    await ui.submit(); ui.render();
    assert.deepEqual(ui.calls.map(call => call.type), ['persistence', 'login']);
    assert.equal(ui.calls[0].persistence, checked ? ui.local : ui.session);
    assert.equal(ui.calls[1].email, 'han@example.test');
    assert.match(ui.text(), /Signed in successfully!/);
    assert.deepEqual(ui.redirects, []);
    ui.fire(1200); assert.deepEqual(ui.redirects, ['/trips']);
    ui.cleanup();
  }
});

test('an in-flight login rejects another submission and password reset', async () => {
  const gate = deferred();
  const ui = harness({ persistence: () => gate.promise });
  ui.change('email', 'han@example.test'); ui.change('current-password', 'password');
  const first = ui.submit(); await ui.submit(); await ui.reset();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].type, 'persistence');
  gate.resolve(); await first; ui.render();
  assert.deepEqual(ui.calls.map(call => call.type), ['persistence', 'login']); ui.cleanup();
});

test('persistence errors keep credentials editable and release the form for retry', async () => {
  let failed = true;
  const ui = harness({ persistence: () => { if (failed) { failed = false; throw { code: 'auth/network-request-failed' }; } } });
  ui.change('email', 'han@example.test'); ui.change('current-password', 'password');
  await ui.submit(); ui.render();
  assert.match(ui.text(), /Could not connect/);
  assert.equal(ui.calls.filter(call => call.type === 'login').length, 0);
  assert.equal(ui.find(node => node.type === 'input' && node.props.autoComplete === 'current-password').props.value, 'password');
  await ui.submit(); ui.render(); assert.match(ui.text(), /Signed in successfully!/); ui.cleanup();
});

test('registration links an anonymous UID, waits for the profile, then preserves success despite a profile failure', async () => {
  const gate = deferred();
  const ui = harness({ mode: 'register', user: { uid: 'anonymous-trip-owner', isAnonymous: true }, profile: () => gate.promise, search: '?next=%2Ftrips' });
  ui.change('name', '  Han Wai Tun  '); ui.change('email', 'han@example.test'); ui.change('new-password', 'password');
  const pending = ui.submit(); await ui.settle();
  assert.deepEqual(ui.calls.map(call => call.type), ['persistence', 'link', 'profile']);
  assert.equal(ui.calls.find(call => call.type === 'link').uid, 'anonymous-trip-owner');
  assert.deepEqual(ui.redirects, []);
  gate.reject(new Error('Profile is unavailable')); await pending; ui.render();
  assert.match(ui.text(), /Account created successfully!/); assert.match(ui.text(), /your name could not be saved/);
  assert.equal(ui.auth.currentUser.uid, 'anonymous-trip-owner'); assert.equal(ui.auth.currentUser.isAnonymous, false);
  ui.emitAuth(ui.auth.currentUser);
  assert.deepEqual(ui.redirects, [], 'A delayed auth callback cannot skip the success message');
  ui.fire(1200); assert.deepEqual(ui.redirects, ['/trips']); ui.cleanup();
});

test('new registration saves a trimmed name and rejects external return destinations', async () => {
  const ui = harness({ mode: 'register', search: '?next=https%3A%2F%2Foutside.example' });
  ui.change('name', '  Han Wai Tun  '); ui.change('email', 'han@example.test'); ui.change('new-password', 'password');
  await ui.submit(); ui.render();
  assert.deepEqual(ui.calls.map(call => call.type), ['persistence', 'register', 'profile']);
  assert.deepEqual(ui.calls[2].profile, { displayName: 'Han Wai Tun' });
  ui.fire(1200); assert.deepEqual(ui.redirects, ['/']); ui.cleanup();
});

test('password reset prompts for an email, then sends trimmed input using the chosen language', async () => {
  const ui = harness();
  await ui.reset();
  assert.match(ui.text(), /Enter your email address to reset/); assert.equal(ui.focusCount(), 1);
  assert.equal(ui.calls.length, 0);
  ui.change('email', '  han@example.test  '); await ui.reset();
  assert.equal(ui.calls.length, 1); assert.deepEqual(ui.calls[0], { type: 'reset', email: 'han@example.test', language: 'ja' });
  assert.match(ui.text(), /Password reset email sent/); ui.cleanup();
});

test('an in-flight reset blocks repeated sends and login, and a failure allows retry', async () => {
  const gate = deferred(); let resetCount = 0;
  const ui = harness({ reset: () => ++resetCount === 1 ? gate.promise : Promise.resolve() });
  ui.change('email', 'han@example.test'); ui.change('current-password', 'password');
  await ui.reset(); await ui.reset(); await ui.submit();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].type, 'reset');
  gate.reject({ code: 'auth/too-many-requests' }); await ui.settle();
  assert.match(ui.text(), /Too many attempts/);
  await ui.reset(); assert.equal(ui.calls.length, 2); assert.match(ui.text(), /Password reset email sent/); ui.cleanup();
});

test('missing Firebase configuration remains visible and cannot request authentication', async () => {
  const ui = harness({ configured: false });
  assert.match(ui.text(), /Firebase Authentication is not configured/);
  ui.fire(3500); assert.match(ui.text(), /Firebase Authentication is not configured/);
  await ui.submit(); assert.equal(ui.calls.length, 0); ui.cleanup();
});
