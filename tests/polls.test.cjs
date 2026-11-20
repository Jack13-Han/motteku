const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Run the real component handlers with React scheduling and Firebase transport
// replaced. These tests never read credentials or contact the live project.
const project = path.resolve(__dirname, '..');
const transpile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const failure = code => Object.assign(new Error('private server response'), { code });
const poll = (overrides = {}) => ({ id: 'poll-one', question: 'Where to meet?', options: ['Station', 'Hotel'], createdBy: 'bob', createdByName: 'Bob', createdAt: 'SERVER_TIMESTAMP', closed: false, ...overrides });

function harness(config = {}) {
  let props = { kind: 'chat', scopeId: 'room-one', uid: 'alice', userName: 'Alice', canManage: false, ...config.props };
  let polls = config.polls || [poll()];
  let index = 0, dirty = false, tree, unmounted = false, generatedId = 0;
  const slots = [], effects = [], writes = [], updates = [], listeners = [], queries = [];
  const auth = { currentUser: { uid: props.uid } };
  const deleted = { kind: 'deleteField' };
  class FieldPath { constructor(...segments) { this.segments = segments; } }
  const react = {
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { if (!unmounted) { slots[at] = typeof value === 'function' ? value(slots[at]) : value; dirty = true; } }]; },
    useRef(initial) { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(effect, deps) { const at = index++, old = slots[at]; if (!old || deps.some((value, position) => !Object.is(value, old.deps[position]))) effects.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: effect() }; }); },
  };
  const jsx = (type, props, key) => ({ type, props: { ...(props || {}), ...(key === undefined ? {} : { key }) } });
  const reference = (...parts) => ({ path: parts.filter(part => typeof part === 'string').join('/') });
  const snapshot = () => ({ docs: polls.map(({ id, pending, ...data }) => ({ id, data: () => data, metadata: { hasPendingWrites: pending === true } })) });
  const firestore = {
    FieldPath, deleteField: () => deleted,
    collection: (...parts) => reference(...parts),
    doc(...parts) { if (parts.length === 1 && parts[0]?.path) return { path: `${parts[0].path}/new-${++generatedId}` }; return reference(...parts); },
    limit: value => ({ limit: value }), orderBy: (...value) => ({ orderBy: value }),
    query(ref, ...constraints) { queries.push({ ref, constraints }); return ref; },
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    onSnapshot(ref, metadata, next, error) { const listener = { ref, metadata, next, error, active: true }; listeners.push(listener); if (!config.holdSnapshot) next(snapshot()); return () => { listener.active = false; }; },
    setDoc(ref, payload) { const result = deferred(); writes.push({ ref, payload, result }); return result.promise; },
    updateDoc(ref, ...args) { const result = deferred(); updates.push({ ref, args, result }); return result.promise; },
  };
  const cache = new Map();
  function local(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const instance = { exports: {} };
    vm.runInNewContext(transpile(filename), { exports: instance.exports, module: instance, require: load }, { filename });
    cache.set(filename, instance.exports); return instance.exports;
  }
  function load(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
    if (name === 'firebase/firestore') return firestore;
    if (name === '@/lib/firebase') return { auth, db: config.noDb ? null : {} };
    if (name === '@/lib/polls') return local(path.join(project, 'lib/polls.ts'));
    if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => String(key) });
    if (name === '@/lib/i18n') return { useLanguage: () => ({ t: (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)) }) };
    throw new Error('Unexpected import: ' + name);
  }
  const component = local(path.join(project, 'components/GroupPolls.tsx')).default;
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    if (typeof node !== 'object') return [node];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const textOf = node => nodes(node).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
  function render() { if (unmounted) return; let turns = 0; do { if (++turns > 30) throw new Error('Render loop'); dirty = false; index = 0; tree = component(props); while (effects.length) effects.shift()(); } while (dirty); }
  function find(predicate, root = tree) { const value = nodes(root).find(node => typeof node === 'object' && predicate(node)); assert.ok(value, 'Expected control not found'); return value; }
  const card = id => find(node => node.props['data-poll-id'] === id);
  const button = (label, id) => find(node => node.type === 'button' && (node.props['aria-label'] === label || textOf(node).trim() === label), id ? card(id) : tree);
  const click = (label, id) => { const control = button(label, id); assert.notEqual(control.props.disabled, true, label + ' disabled'); const result = control.props.onClick(); render(); return result; };
  const input = (label, value) => { find(node => node.type === 'input' && node.props['aria-label'] === label).props.onChange({ target: { value } }); render(); };
  const submit = () => { const result = find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); return result; };
  async function flush() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); render(); } }
  function emit(values = polls) { polls = values; for (const listener of listeners) if (listener.active) listener.next(snapshot()); render(); }
  async function commit(update) {
    const [field, value] = update.args;
    polls = polls.map(item => {
      if (!update.ref.path.endsWith('/' + item.id)) return item;
      if (!(field instanceof FieldPath)) return { ...item, ...field };
      const votes = { ...item.votes };
      if (value === deleted) delete votes[field.segments[1]]; else votes[field.segments[1]] = value;
      return { ...item, votes };
    });
    emit(); update.result.resolve(); await flush();
  }
  render();
  return {
    auth, writes, updates, listeners, queries, deleted, FieldPath, nodes, find, card, button, click, input, submit, flush, emit, commit, textOf,
    text: () => textOf(tree), helpers: local(path.join(project, 'lib/polls.ts')),
    setProps(next) { props = { ...props, ...next }; render(); },
    error(error) { listeners.at(-1).error(error); render(); },
    unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

const draft = h => { h.input('Poll question', '  Lunch?  '); h.input('Option 1', '  Sushi '); h.input('Option 2', ' Ramen  '); };

test('draft validation trims values, respects Unicode boundaries and rejects invalid or duplicate options', () => {
  const h = harness(), { validatePollDraft } = h.helpers;
  assert.deepEqual(plain(validatePollDraft('  Lunch? ', [' Sushi ', ' Ramen '], ' Alice ')), { ok: true, question: 'Lunch?', options: ['Sushi', 'Ramen'], createdByName: 'Alice' });
  assert.equal(validatePollDraft('😀'.repeat(100), ['A', 'B'], 'A').ok, true);
  assert.equal(validatePollDraft('😀'.repeat(101), ['A', 'B'], 'A').ok, false);
  assert.equal(validatePollDraft('က'.repeat(200), ['😀'.repeat(50), 'B'], '😀'.repeat(40)).ok, true);
  assert.equal(validatePollDraft('Q', ['😀'.repeat(51), 'B'], 'A').ok, false);
  assert.equal(validatePollDraft('Q', ['A', 'B'], '😀'.repeat(41)).ok, false);
  for (const choices of [['A'], ['A', ' A '], ['A', ''], ['A', 'B'.repeat(101)], ['A', 'B', 'C', 'D', 'E', 'F']]) assert.equal(validatePollDraft('Q', choices, 'A').ok, false);
  assert.equal(validatePollDraft('Q', ['A', 'B'], ' ').ok, false);
  assert.equal(validatePollDraft('Q', ['A', 'B'], 'A'.repeat(81)).ok, false); h.unmount();
});

test('results ignore malformed votes and inherited UID values', () => {
  const h = harness(), { pollResults, readPoll, pollErrorCode } = h.helpers;
  const results = pollResults(['A', 'B'], { alice: 1, bob: 0, negative: -1, fraction: 0.5, string: '1', high: 2, nil: null }, 'alice');
  assert.equal(results.total, 2); assert.equal(results.selectedIndex, 1);
  assert.deepEqual(plain(results.options.map(item => [item.count, item.percent, item.selected])), [[1, 50, false], [1, 50, true]]);
  assert.equal(pollResults(['A', 'B'], Object.create({ alice: 0 }), 'alice').selectedIndex, null);
  assert.equal(pollResults(['A', 'B'], [], 'alice').total, 0);
  assert.equal(readPoll('bad/id', poll()), null); assert.equal(readPoll('one', { ...poll(), options: ['A', 'A'] }), null);
  assert.equal(pollErrorCode(failure('firestore/permission-denied')), 'permission-denied');
  assert.equal(pollErrorCode(failure('private-token')), undefined); h.unmount();
});

test('poll subscription requests latest 20 and metadata updates on the correct parent path', () => {
  for (const [kind, parent] of [['chat', 'sharedTrips'], ['trip', 'trips']]) {
    const h = harness({ props: { kind } });
    assert.equal(h.listeners[0].ref.path, parent + '/room-one/polls');
    assert.equal(h.listeners[0].metadata.includeMetadataChanges, true);
    assert.deepEqual(h.queries[0].constraints, [{ orderBy: ['createdAt', 'desc'] }, { limit: 20 }]); h.unmount();
  }
});

test('creation writes only the agreed schema, trims content and clears the draft after success', async () => {
  const h = harness(); draft(h); const operation = h.submit(); h.submit();
  assert.equal(h.writes.length, 1, 'Immediate duplicate submits must share a ref lock');
  const { payload, ref, result } = h.writes[0]; assert.equal(ref.path, 'sharedTrips/room-one/polls/new-1');
  assert.deepEqual(plain(payload), { question: 'Lunch?', options: ['Sushi', 'Ramen'], createdBy: 'alice', createdByName: 'Alice', createdAt: 'SERVER_TIMESTAMP', closed: false });
  assert.equal(h.find(node => node.props['aria-label'] === 'Poll question').props.disabled, true);
  result.resolve(); await operation; await h.flush();
  assert.equal(h.find(node => node.props['aria-label'] === 'Poll question').props.value, ''); assert.match(h.text(), /Poll created\./); h.unmount();
});

test('failed creation keeps the draft and shows only a safe error code', async () => {
  const h = harness(); draft(h); const operation = h.submit();
  h.writes[0].result.reject(failure('permission-denied')); await operation; await h.flush();
  assert.equal(h.find(node => node.props['aria-label'] === 'Poll question').props.value, '  Lunch?  ');
  assert.match(h.text(), /permission-denied/); assert.doesNotMatch(h.text(), /private server response/);
  const retry = h.submit(); assert.equal(h.writes.length, 2); h.writes[1].result.resolve(); await retry; h.unmount();
});

test('invalid forms do not write and option controls are limited to 2–5', () => {
  const h = harness(); h.submit(); assert.equal(h.writes.length, 0); assert.match(h.text(), /Enter a poll question/);
  for (let count = 0; count < 3; count++) h.click('Add option');
  assert.equal(h.button('Add option').props.disabled, true);
  h.button('Add option').props.onClick();
  assert.equal(h.nodes().filter(node => typeof node === 'object' && node.type === 'input').length, 6);
  h.click('Remove option 5'); h.click('Remove option 4'); h.click('Remove option 3');
  assert.equal(h.nodes().some(node => typeof node === 'object' && String(node.props['aria-label']).startsWith('Remove option')), false); h.unmount();
});

test('vote changes and removal update only the UID field, including punctuation in UID', async () => {
  const h = harness({ props: { uid: 'alice.name' }, polls: [poll({ votes: { bob: 0 } })] });
  h.click('Vote for Hotel', 'poll-one');
  const first = h.updates[0]; assert.equal(first.args[0] instanceof h.FieldPath, true);
  assert.deepEqual(first.args[0].segments, ['votes', 'alice.name']); assert.equal(first.args[1], 1);
  h.button('Vote for Hotel', 'poll-one').props.onClick(); assert.equal(h.updates.length, 1);
  await h.commit(first); assert.equal(h.button('Vote for Hotel', 'poll-one').props['aria-pressed'], true); assert.match(h.text(), /2 votes/);
  h.click('Vote for Station', 'poll-one'); assert.equal(h.updates[1].args[1], 0); await h.commit(h.updates[1]);
  assert.equal(h.button('Vote for Station', 'poll-one').props['aria-pressed'], true);
  h.click('Vote for Station', 'poll-one'); assert.equal(h.updates[2].args[1], h.deleted); await h.commit(h.updates[2]);
  assert.equal(h.button('Vote for Station', 'poll-one').props['aria-pressed'], false); assert.match(h.text(), /1 votes/); h.unmount();
});

test('failed vote unlocks controls, while distinct polls may be updated concurrently', async () => {
  const h = harness({ polls: [poll(), poll({ id: 'poll-two' })] });
  const first = h.click('Vote for Station', 'poll-one'); const second = h.click('Vote for Hotel', 'poll-two');
  assert.equal(h.updates.length, 2);
  h.updates[0].result.reject(failure('unavailable')); await first; await h.flush();
  assert.equal(h.button('Vote for Station', 'poll-one').props.disabled, false);
  assert.equal(h.button('Vote for Hotel', 'poll-two').props.disabled, true);
  h.updates[1].result.resolve(); await second; await h.flush(); assert.match(h.text(), /Could not save your vote/); h.unmount();
});

test('only creator or organizer can close; close writes its exact fields and then locks voting', async () => {
  const ordinary = harness(); assert.equal(ordinary.nodes(ordinary.card('poll-one')).some(node => typeof node === 'object' && node.type === 'button' && ordinary.textOf(node) === 'Close poll'), false); ordinary.unmount();
  for (const props of [{ canManage: true }, { uid: 'bob' }]) {
    const h = harness({ props }); const close = h.click('Close poll', 'poll-one');
    h.button('Close poll', 'poll-one').props.onClick(); h.button('Vote for Hotel', 'poll-one').props.onClick(); assert.equal(h.updates.length, 1);
    assert.deepEqual(plain(h.updates[0].args), [{ closed: true, closedAt: 'SERVER_TIMESTAMP' }]);
    await h.commit(h.updates[0]); await close;
    assert.equal(h.button('Vote for Station', 'poll-one').props.disabled, true); assert.match(h.text(), /Closed/); h.unmount();
  }
});

test('closed, pending, loading and completed views reject even direct stale handler calls', () => {
  for (const config of [{ polls: [poll({ closed: true })] }, { polls: [poll({ pending: true })] }, { props: { disabled: true } }]) {
    const h = harness(config); const control = h.button('Vote for Station', 'poll-one'); assert.equal(control.props.disabled, true); control.props.onClick(); assert.equal(h.updates.length, 0); h.unmount();
  }
  const loading = harness({ holdSnapshot: true }); assert.equal(loading.button('Create poll').props.disabled, true); loading.submit(); assert.equal(loading.writes.length, 0); loading.unmount();
  const h = harness({ props: { canManage: true } }); const close = h.button('Close poll', 'poll-one'); const vote = h.button('Vote for Station', 'poll-one');
  h.setProps({ canManage: false, disabled: true }); close.props.onClick(); vote.props.onClick(); assert.equal(h.updates.length, 0); h.unmount();
});

test('scope and account changes suppress old writes and listener callbacks without clearing new drafts', async () => {
  const h = harness(); draft(h); const oldSubmit = h.find(node => node.type === 'form').props.onSubmit;
  const operation = h.submit(); const listener = h.listeners[0]; h.setProps({ kind: 'trip', scopeId: 'trip-two' });
  h.input('Poll question', 'New scope draft'); oldSubmit({ preventDefault() {} }); assert.equal(h.writes.length, 1);
  listener.error(failure('permission-denied')); listener.next({ docs: [] }); h.writes[0].result.resolve(); await operation; await h.flush();
  assert.equal(h.find(node => node.props['aria-label'] === 'Poll question').props.value, 'New scope draft'); assert.doesNotMatch(h.text(), /permission-denied/);
  draft(h); const accountWrite = h.submit(); h.auth.currentUser = { uid: 'charlie' }; h.setProps({ uid: 'charlie', userName: 'Charlie' });
  h.input('Poll question', 'New account draft'); h.writes[1].result.reject(failure('unavailable')); await accountWrite; await h.flush();
  assert.equal(h.find(node => node.props['aria-label'] === 'Poll question').props.value, 'New account draft'); assert.doesNotMatch(h.text(), /unavailable/); h.unmount();
});

test('a stale vote handler cannot change a newly closed poll or write for a different authenticated account', () => {
  const h = harness(); const vote = h.button('Vote for Station', 'poll-one');
  h.emit([poll({ closed: true })]); vote.props.onClick(); assert.equal(h.updates.length, 0);
  h.emit([poll()]); h.auth.currentUser = { uid: 'someone-else' }; h.button('Vote for Hotel', 'poll-one').props.onClick(); draft(h); h.submit();
  assert.equal(h.updates.length, 0); assert.equal(h.writes.length, 0); h.unmount();
});

test('missing setup, load errors and malformed documents are explained without fake saves or raw server data', () => {
  for (const config of [{ noDb: true }, { props: { uid: '' } }, { props: { scopeId: 'bad/id' } }]) {
    const h = harness(config); assert.match(h.text(), /Sign in and connect Firebase/); assert.equal(h.listeners.length, 0); assert.equal(h.writes.length, 0); h.unmount();
  }
  const h = harness({ polls: [poll({ options: [] })] }); assert.match(h.text(), /No polls yet/);
  h.error(failure('private-token')); assert.match(h.text(), /Could not load polls/); assert.doesNotMatch(h.text(), /private-token|private server response/);
  assert.equal(h.button('Create poll').props.disabled, true); h.unmount();
});

test('unmount invalidates pending writes and late snapshots', async () => {
  const h = harness(); draft(h); const operation = h.submit(); const listener = h.listeners[0]; h.unmount();
  assert.equal(listener.active, false); listener.error(failure('permission-denied')); h.writes[0].result.reject(failure('unavailable')); await operation; await h.flush();
  assert.equal(h.writes.length, 1);
});
