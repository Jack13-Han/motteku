const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the real component and event handlers, replacing only React scheduling
// and Firebase transport. These checks do not contact a production project.
const project = path.resolve(__dirname, '..');
const componentPath = path.join(project, 'components/TripChat.tsx');
const transpile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const failure = code => Object.assign(new Error('Transport failed'), { code });
const timestamp = { toDate: () => new Date('2026-11-10T08:00:00Z') };
const message = (overrides = {}) => ({ id: 'AAAAAAAAAAAAAAAAAAAA', senderUid: 'bob', senderName: 'Bob', text: 'Bring the map.', createdAt: timestamp, ...overrides });

function harness(options = {}) {
  let props = { tripId: 'trip-one', chatId: 'room-one', inviteCode: 'invite-one', userUid: 'alice', userName: 'Alice', tripName: 'Holiday', onRoomChange() {}, onJoinedRoom() {}, onNotice() {}, ...options.props };
  let index = 0, dirty = false, tree, unmounted = false, nextMessage = 0;
  let messages = options.messages || [message()];
  const slots = [], effects = [], writes = [], updates = [], listeners = [], imported = [], jumped = [], reads = [];
  const auth = { currentUser: { uid: props.userUid } };
  const react = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { if (!unmounted) { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; dirty = true; } }]; },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect(effect, deps) { const slot = index++, old = slots[slot]; if (!old || !deps || deps.some((value, at) => !Object.is(value, old.deps?.[at]))) effects.push(() => { old?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; }); },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
  };
  const jsx = (type, props, key) => ({ type, props: { ...(props || {}), ...(key === undefined ? {} : { key }) } });
  function reference(...parts) { return { path: parts.filter(part => typeof part === 'string').join('/') }; }
  const deleted = Object.freeze({ kind: 'deleteField' });
  class FieldPath { constructor(...segments) { this.segments = segments; } }
  function snapshotMessages() {
    return { docs: [...messages].reverse().map(item => ({ id: item.id, data: () => { const { id, ...data } = item; return data; }, metadata: { hasPendingWrites: item.pending === true } })), metadata: { hasPendingWrites: false } };
  }
  const firestore = {
    FieldPath, deleteField: () => deleted,
    collection: (...parts) => reference(...parts),
    doc(...parts) { if (parts.length === 1 && parts[0]?.path) { const id = (++nextMessage).toString().padStart(20, 'A'); return { path: parts[0].path + '/' + id, id }; } return reference(...parts); },
    getDoc: async ref => {
      if (options.deferMessageReads && ref.path?.includes('/messages/')) { const result = deferred(); reads.push({ ref, result }); return result.promise; }
      const target = messages.find(item => ref.path?.endsWith('/messages/' + item.id));
      return { id: ref.path?.split('/').at(-1), exists: () => Boolean(target || !ref.path?.includes('/messages/')), data: () => target || { name: 'Holiday', inviteCode: 'invite-one' }, metadata: { hasPendingWrites: false } };
    },
    limit: count => ({ limit: count }), orderBy: (...values) => ({ orderBy: values }), query: value => value,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    onSnapshot(ref, ...args) {
      const [next, error] = typeof args[0] === 'function' ? args : args.slice(1);
      const listener = { ref, next, error, active: true }; listeners.push(listener);
      next(ref.path?.endsWith('/members') ? { docs: [{ id: 'alice', data: () => ({ name: 'Alice' }) }, { id: 'bob', data: () => ({ name: 'Bob' }) }] } : snapshotMessages());
      return () => { listener.active = false; };
    },
    setDoc(ref, payload) { const result = deferred(); writes.push({ ref, payload, result }); return result.promise; },
    updateDoc(ref, ...args) { const result = deferred(); updates.push({ ref, args, result }); return result.promise; },
  };
  const session = new Map();
  const globals = {
    URL, Error, console, queueMicrotask, setTimeout, clearTimeout,
    window: { location: { href: 'https://motteku.test/', origin: 'https://motteku.test', pathname: '/', hostname: 'motteku.test' }, history: { replaceState() {} } },
    document: { getElementById(id) { return { scrollIntoView: () => jumped.push(id), focus() {} }; } },
    sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    navigator: { clipboard: { writeText: async () => {} } },
    requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {},
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
  };
  const moduleCache = new Map();
  function localModule(filename) { if (moduleCache.has(filename)) return moduleCache.get(filename); const value = { exports: {} }; moduleCache.set(filename, value.exports); vm.runInNewContext(transpile(filename), { ...globals, exports: value.exports, module: value, require: load }, { filename }); moduleCache.set(filename, value.exports); return value.exports; }
  function load(name) {
    imported.push(name);
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
    if (name === 'firebase/firestore') return firestore;
    if (name === 'firebase/storage') throw new Error('Group chat must not import Firebase Storage');
    if (name === '@/lib/firebase') return { auth, db: {} };
    if (name === '@/lib/chat') return localModule(path.join(project, 'lib/chat.ts'));
    if (name === '@/lib/chatSendError') return localModule(path.join(project, 'lib/chatSendError.ts'));
    if (name === 'lucide-react') return new Proxy({}, { get: (_target, key) => String(key) });
    if (name === '@/lib/i18n') return { useLanguage: () => ({ language: 'en', t: (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)) }) };
    throw new Error('Unexpected import: ' + name);
  }
  const component = { exports: {} };
  vm.runInNewContext(transpile(componentPath), { ...globals, exports: component.exports, module: component, require: load }, { filename: componentPath });
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (node == null || typeof node === 'boolean') return [];
    if (Array.isArray(node)) return node.flatMap(value => nodes(value));
    if (typeof node !== 'object') return [node];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const textOf = node => nodes(node).filter(value => typeof value === 'string' || typeof value === 'number').join(' ');
  function render() { if (unmounted) return; let turns = 0; do { if (++turns > 30) throw new Error('Component render loop'); dirty = false; index = 0; tree = component.exports.default(props); while (effects.length) effects.shift()(); } while (dirty); }
  function find(predicate, root = tree) { const node = nodes(root).find(value => typeof value === 'object' && predicate(value)); assert.ok(node, 'Expected control not found'); return node; }
  const messageNode = id => find(node => node.props['data-message-id'] === id || node.props.id === `chat-message-${id}` || node.props.key === id && String(node.props.className || '').split(' ').includes('chat-message'));
  const button = (label, id) => find(node => node.type === 'button' && (node.props['aria-label'] === label || textOf(node).trim() === label), id ? messageNode(id) : tree);
  function click(label, id) { const node = button(label, id); assert.notEqual(node.props.disabled, true, 'Control is disabled: ' + label); const result = node.props.onClick?.(); render(); return result; }
  const input = value => { find(node => node.type === 'textarea').props.onChange({ target: { value } }); render(); };
  const submit = () => { const result = find(node => node.type === 'form' && node.props.className === 'chat-compose').props.onSubmit({ preventDefault() {} }); render(); return result; };
  function emit(next = messages) { messages = next; for (const listener of listeners) if (listener.active && listener.ref.path?.endsWith('/messages')) listener.next(snapshotMessages()); render(); }
  async function flush() { for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); render(); } }
  async function commitUpdate(update) {
    const [field, value] = update.args;
    assert.ok(field instanceof FieldPath, 'Reaction writes must use a segmented FieldPath');
    assert.equal(field.segments[0], 'reactions');
    const id = update.ref.path.split('/').at(-1);
    const updated = messages.map(item => { if (item.id !== id) return item; const reactions = { ...item.reactions }; if (value === deleted) delete reactions[field.segments[1]]; else reactions[field.segments[1]] = value; return { ...item, reactions }; });
    emit(updated); update.result.resolve(); await flush();
  }
  render();
  return { auth, imported, writes, updates, reads, nodes, find, button, click, input, submit, flush, emit, commitUpdate, messageNode, deleted, textOf, text: () => textOf(tree), setProps(next) { props = { ...props, ...next }; render(); }, unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); } };
}

const composer = h => h.find(node => node.type === 'form' && node.props.className === 'chat-compose');
const sendAlert = h => h.find(node => node.props.role === 'alert' && node.props['data-chat-send-error'] === 'true', composer(h));
const hasSendAlert = h => h.nodes(composer(h)).some(node => typeof node === 'object' && node.props.role === 'alert' && node.props['data-chat-send-error'] === 'true');

test('chat has no image picker or Storage dependency and provides exactly five reaction choices per message', () => {
  const h = harness();
  assert.equal(h.nodes().some(node => typeof node === 'object' && node.type === 'input' && node.props.type === 'file'), false);
  assert.equal(h.imported.includes('firebase/storage'), false);
  const controls = h.nodes(h.messageNode('AAAAAAAAAAAAAAAAAAAA')).filter(node => typeof node === 'object' && node.type === 'button' && ['Like', 'Angry', 'OK', 'Haha', 'Sad'].includes(node.props['aria-label']));
  assert.equal(controls.length, 5);
  for (const [label, emoji] of [['Like', '👍'], ['Angry', '😡'], ['OK', '👌'], ['Haha', '😂'], ['Sad', '😢']]) assert.ok(h.text().includes(emoji), label);
  h.unmount();
});

test('plain text sends trimmed content without photo, reply or forged initial reactions', async () => {
  const h = harness(); h.input('  Hello group  '); const sending = h.submit(); await h.flush();
  assert.equal(h.writes.length, 1); const payload = h.writes[0].payload;
  assert.equal(payload.text, 'Hello group'); assert.equal(payload.senderUid, 'alice');
  assert.deepEqual(Object.keys(payload).sort(), ['createdAt', 'senderName', 'senderUid', 'text']);
  h.writes[0].result.resolve(); await sending; await h.flush();
  assert.equal(h.find(node => node.type === 'textarea').props.value, ''); h.unmount();
});

test('reply sends the original message identity and quote, then clears the selected reply on success', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('I have it.');
  h.button('Cancel reply'); const sending = h.submit(); await h.flush();
  assert.equal(h.writes.length, 1); const reply = h.writes[0].payload.replyTo;
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), { messageId: 'AAAAAAAAAAAAAAAAAAAA', senderUid: 'bob', senderName: 'Bob', text: 'Bring the map.' });
  h.writes[0].result.resolve(); await sending; await h.flush();
  assert.equal(h.nodes().some(node => typeof node === 'object' && node.type === 'button' && node.props['aria-label'] === 'Cancel reply'), false); h.unmount();
});

test('failed reply keeps both text and selected original for a retry', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Keep this reply'); const sending = h.submit();
  await h.flush();
  h.writes[0].result.reject(failure('permission-denied')); await sending; await h.flush();
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Keep this reply'); h.button('Cancel reply');
  const alert = sendAlert(h);
  assert.match(h.textOf(alert), /Reply was blocked\. Publish the latest Firestore rules, then try again\./);
  assert.match(h.textOf(alert), /permission-denied/);
  assert.equal(h.writes.length, 1, 'A rejected reply must not silently retry as a plain message');
  h.unmount();
});

test('canceling a reply keeps the draft and sends it as an ordinary message', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Ordinary text'); h.click('Cancel reply'); const sending = h.submit();
  assert.equal('replyTo' in h.writes[0].payload, false); assert.equal(h.writes[0].payload.text, 'Ordinary text');
  h.writes[0].result.resolve(); await sending; await h.flush(); h.unmount();
});

test('repeated Send while a message is pending cannot publish duplicates', async () => {
  const h = harness(); h.input('Only once'); const sending = h.submit(); h.submit(); await h.flush();
  assert.equal(h.writes.length, 1); assert.equal(h.find(node => node.type === 'textarea').props.disabled, true);
  h.writes[0].result.resolve(); await sending; await h.flush(); h.unmount();
});

test('pending local messages cannot be selected as a reply target', () => {
  const h = harness({ messages: [message({ createdAt: null, pending: true })] });
  const controls = h.nodes(h.messageNode('AAAAAAAAAAAAAAAAAAAA')).filter(node => typeof node === 'object' && node.type === 'button' && String(node.props['aria-label'] || '').startsWith('Reply to'));
  assert.ok(controls.length === 0 || controls.every(node => node.props.disabled)); h.unmount();
});

test('changing rooms clears reply and draft while a late old send cannot clear a new draft', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Old room'); const sending = h.submit();
  await h.flush();
  h.setProps({ tripId: 'trip-two', chatId: 'room-two', inviteCode: 'invite-two' }); h.input('New room draft');
  h.writes[0].result.resolve(); await sending; await h.flush();
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'New room draft');
  assert.equal(h.nodes().some(node => typeof node === 'object' && node.type === 'button' && node.props['aria-label'] === 'Cancel reply'), false); h.unmount();
});

test('changing accounts clears selected replies and suppresses a prior account send failure', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Old account'); const sending = h.submit();
  await h.flush();
  h.auth.currentUser = { uid: 'charlie' }; h.setProps({ userUid: 'charlie', userName: 'Charlie' });
  h.writes[0].result.reject(failure('permission-denied')); await sending; await h.flush();
  assert.equal(h.find(node => node.type === 'textarea').props.value, '');
  assert.equal(h.nodes().some(node => typeof node === 'object' && node.props.role === 'alert'), false); h.unmount();
});

test('a reaction writes only the current UID field and synchronized snapshots show counts and selection', async () => {
  const h = harness({ messages: [message({ reactions: { bob: 'like' } })] }); h.click('Like', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush();
  assert.equal(h.updates.length, 1); assert.deepEqual(h.updates[0].args[0].segments, ['reactions', 'alice']); assert.equal(h.updates[0].args[1], 'like');
  await h.commitUpdate(h.updates[0]); const control = h.button('Like', 'AAAAAAAAAAAAAAAAAAAA');
  assert.equal(control.props['aria-pressed'], true); assert.match(h.textOf(control), /2/); h.unmount();
});

test('changing a reaction and clicking it again removes only the current UID reaction', async () => {
  const h = harness({ messages: [message({ reactions: { alice: 'like', bob: 'like' } })] });
  h.click('Angry', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush(); assert.equal(h.updates[0].args[1], 'angry'); await h.commitUpdate(h.updates[0]);
  assert.equal(h.button('Like', 'AAAAAAAAAAAAAAAAAAAA').props['aria-pressed'], false); assert.equal(h.button('Angry', 'AAAAAAAAAAAAAAAAAAAA').props['aria-pressed'], true);
  assert.match(h.textOf(h.button('Like', 'AAAAAAAAAAAAAAAAAAAA')), /1/);
  h.click('Angry', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush(); assert.equal(h.updates[1].args[1], h.deleted); await h.commitUpdate(h.updates[1]);
  assert.equal(h.button('Angry', 'AAAAAAAAAAAAAAAAAAAA').props['aria-pressed'], false);
  assert.equal(h.button('Like', 'AAAAAAAAAAAAAAAAAAAA').props['aria-pressed'], false); h.unmount();
});

test('a pending reaction guards duplicate clicks and releases its controls after a failed write', async () => {
  const h = harness(); h.click('Haha', 'AAAAAAAAAAAAAAAAAAAA');
  // Directly invoke the handler to test its ref guard as well as disabled UI.
  h.button('Haha', 'AAAAAAAAAAAAAAAAAAAA').props.onClick?.(); await h.flush(); assert.equal(h.updates.length, 1);
  h.updates[0].result.reject(failure('permission-denied')); await h.flush();
  assert.equal(h.button('Haha', 'AAAAAAAAAAAAAAAAAAAA').props.disabled, false);
  assert.ok(h.nodes().some(node => typeof node === 'object' && node.props.role === 'alert'));
  h.click('Haha', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush(); assert.equal(h.updates.length, 2); await h.commitUpdate(h.updates[1]); h.unmount();
});

test('a reaction error from a previous room cannot leak into the current room', async () => {
  const h = harness(); h.click('Sad', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush();
  h.setProps({ tripId: 'trip-two', chatId: 'room-two', inviteCode: 'invite-two' });
  h.updates[0].result.reject(failure('permission-denied')); await h.flush();
  assert.equal(h.nodes().some(node => typeof node === 'object' && node.props.role === 'alert'), false);
  assert.equal(h.button('Sad', 'AAAAAAAAAAAAAAAAAAAA').props.disabled, false); h.unmount();
});

test('UIDs with punctuation use a FieldPath instead of dotted strings', async () => {
  const h = harness({ props: { userUid: 'alice.test', userName: 'Alice' } }); h.click('OK', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush();
  assert.deepEqual(h.updates[0].args[0].segments, ['reactions', 'alice.test']); await h.commitUpdate(h.updates[0]); h.unmount();
});

test('a reply refreshes its quoted source instead of sending a stale snapshot', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Reply');
  h.emit([message({ senderName: 'Robert', text: 'Bring the compass instead.' })]);
  const sending = h.submit(); await h.flush();
  assert.equal(h.writes[0].payload.replyTo.senderName, 'Robert'); assert.equal(h.writes[0].payload.replyTo.text, 'Bring the compass instead.');
  h.writes[0].result.resolve(); await sending; await h.flush(); h.unmount();
});

test('a missing original prevents a reply write and preserves the draft', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Keep draft'); h.emit([]);
  await h.submit(); await h.flush();
  assert.equal(h.writes.length, 0); assert.equal(h.find(node => node.type === 'textarea').props.value, 'Keep draft');
  assert.match(h.textOf(sendAlert(h)), /original message is not available/i); h.unmount();
});

test('a denied original-message read shows an inline source error and never attempts a reply write', async () => {
  const h = harness({ deferMessageReads: true }); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Keep original reply');
  const sending = h.submit(); await h.flush();
  h.reads[0].result.reject(failure('permission-denied')); await sending; await h.flush();
  assert.equal(h.writes.length, 0);
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Keep original reply'); h.button('Cancel reply');
  const text = h.textOf(sendAlert(h));
  assert.match(text, /permission-denied/);
  assert.doesNotMatch(text, /Reply was blocked\. Publish the latest Firestore rules/);
  assert.match(text, /original|read|membership/i);
  h.unmount();
});

test('network and expired-sign-in failures keep the reply draft and expose only safe codes beside Send', async () => {
  for (const code of ['unavailable', 'unauthenticated']) {
    const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Retry after recovery');
    const sending = h.submit(); await h.flush(); h.writes[0].result.reject(failure(code)); await sending; await h.flush();
    assert.equal(h.find(node => node.type === 'textarea').props.value, 'Retry after recovery'); h.button('Cancel reply');
    assert.match(h.textOf(sendAlert(h)), new RegExp(code));
    assert.doesNotMatch(h.textOf(sendAlert(h)), /Reply was blocked/);
    assert.equal(h.button('Send message').props.disabled, false); h.unmount();
  }
});

test('an authentication change before Send shows an inline sign-in error without publishing a message', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Keep this account draft');
  h.auth.currentUser = { uid: 'different-account' };
  await h.submit(); await h.flush();
  assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
  assert.match(h.textOf(sendAlert(h)), /sign|login|session/i);
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Keep this account draft'); h.unmount();
});

test('an unknown Firebase failure cannot leak its raw server response into composer feedback', async () => {
  const secret = 'SECRET_PROVIDER_TOKEN_private_server_detail';
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Keep me');
  const sending = h.submit(); await h.flush();
  h.writes[0].result.reject(Object.assign(new Error(secret), { code: 'https://private.example/' + secret }));
  await sending; await h.flush();
  assert.ok(h.textOf(sendAlert(h)).length > 10);
  assert.equal(h.text().includes(secret), false); assert.equal(h.text().includes('private.example'), false);
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'Keep me'); h.unmount();
});

test('retrying a rejected reply clears old feedback and a successful write clears the reply and draft', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Try this reply again');
  const first = h.submit(); await h.flush(); h.writes[0].result.reject(failure('permission-denied')); await first; await h.flush();
  assert.equal(hasSendAlert(h), true);
  const retry = h.submit(); await h.flush(); assert.equal(hasSendAlert(h), false);
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].payload.replyTo.messageId, 'AAAAAAAAAAAAAAAAAAAA');
  h.writes[1].result.resolve(); await retry; await h.flush();
  assert.equal(hasSendAlert(h), false); assert.equal(h.find(node => node.type === 'textarea').props.value, '');
  assert.equal(h.nodes(composer(h)).some(node => typeof node === 'object' && node.props['aria-label'] === 'Cancel reply'), false);
  h.unmount();
});

test('canceling a failed reply clears its reply-only error while preserving the text draft', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Send as ordinary text');
  const first = h.submit(); await h.flush(); h.writes[0].result.reject(failure('permission-denied')); await first; await h.flush();
  assert.equal(hasSendAlert(h), true); h.click('Cancel reply');
  assert.equal(hasSendAlert(h), false); assert.equal(h.find(node => node.type === 'textarea').props.value, 'Send as ordinary text');
  const sending = h.submit(); await h.flush(); assert.equal('replyTo' in h.writes[1].payload, false);
  h.writes[1].result.resolve(); await sending; await h.flush(); h.unmount();
});

test('switching groups clears existing composer failure details instead of carrying them into another chat', async () => {
  const h = harness(); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Old room');
  const sending = h.submit(); await h.flush(); h.writes[0].result.reject(failure('permission-denied')); await sending; await h.flush();
  assert.equal(hasSendAlert(h), true);
  h.setProps({ tripId: 'trip-two', chatId: 'room-two', inviteCode: 'invite-two' });
  assert.equal(hasSendAlert(h), false); assert.equal(h.text().includes('permission-denied'), false); h.unmount();
});

test('chat send error mapping distinguishes read and write permissions and suppresses raw diagnostics', () => {
  const value = { exports: {} }, filename = path.join(project, 'lib/chatSendError.ts');
  vm.runInNewContext(transpile(filename), { module: value, exports: value.exports, Error }, { filename });
  const { chatSendError } = value.exports;
  const blocked = chatSendError(failure('permission-denied'), 'message-write', true);
  assert.equal(blocked.message, 'Reply was blocked. Publish the latest Firestore rules, then try again.');
  assert.equal(blocked.code, 'permission-denied');
  assert.notEqual(chatSendError(failure('permission-denied'), 'reply-read', true).message, blocked.message);
  assert.notEqual(chatSendError(failure('permission-denied'), 'message-write', false).message, blocked.message);
  for (const [code, pattern] of [['unavailable', /connect|network|offline/i], ['unauthenticated', /sign|login|session/i]]) {
    const result = chatSendError(failure(code), 'message-write', true);
    assert.equal(result.code, code); assert.match(result.message, pattern);
  }
  const secret = 'SECRET_SERVER_RESPONSE';
  const unknown = chatSendError(Object.assign(new Error(secret), { code: 'https://invalid/' + secret }), 'message-write', true);
  assert.equal(unknown.code, ''); assert.equal(unknown.message.includes(secret), false);
});

test('switching account while the original message is loading prevents the delayed reply write', async () => {
  const h = harness({ deferMessageReads: true }); h.click('Reply to Bob', 'AAAAAAAAAAAAAAAAAAAA'); h.input('Old account');
  const sending = h.submit(); await h.flush(); assert.equal(h.reads.length, 1);
  h.auth.currentUser = { uid: 'charlie' }; h.setProps({ userUid: 'charlie', userName: 'Charlie' }); h.input('New account draft');
  h.reads[0].result.resolve({ id: 'AAAAAAAAAAAAAAAAAAAA', exists: () => true, data: () => message(), metadata: { hasPendingWrites: false } });
  await sending; await h.flush(); assert.equal(h.writes.length, 0);
  assert.equal(h.find(node => node.type === 'textarea').props.value, 'New account draft'); h.unmount();
});

test('pending local messages cannot receive reactions and an auth mismatch cannot write a reaction', async () => {
  const h = harness({ messages: [message({ createdAt: null, pending: true })] });
  for (const label of ['Like', 'Angry', 'OK', 'Haha', 'Sad']) assert.equal(h.button(label, 'AAAAAAAAAAAAAAAAAAAA').props.disabled, true);
  h.emit([message()]); h.auth.currentUser = { uid: 'someone-else' };
  h.click('Like', 'AAAAAAAAAAAAAAAAAAAA'); await h.flush(); assert.equal(h.updates.length, 0); h.unmount();
});

test('reaction-only snapshots do not announce new messages while scrolled up, but a newly added message does', () => {
  const h = harness();
  const list = h.find(node => node.props.className === 'chat-messages');
  list.props.ref.current = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 };
  list.props.onScroll();
  const hasNewBadge = () => h.nodes().some(node => typeof node === 'object' && node.type === 'button' && h.textOf(node).trim() === 'New messages');
  h.emit([message({ reactions: { bob: 'haha' } })]);
  assert.equal(hasNewBadge(), false);
  h.emit([message({ reactions: { bob: 'haha' } }), message({ id: 'BBBBBBBBBBBBBBBBBBBB', text: 'A genuinely new message.' })]);
  assert.equal(hasNewBadge(), true);
  h.click('New messages'); assert.equal(hasNewBadge(), false);
  h.unmount();
});

test('reaction summaries ignore malformed stored data and inherited properties', () => {
  const module = { exports: {} };
  const filename = path.join(project, 'lib/chat.ts');
  vm.runInNewContext(transpile(filename), { module, exports: module.exports }, { filename });
  const { reactionSummary } = module.exports;
  for (const malformed of [undefined, null, false, 42, 'like', ['like', 'sad']]) {
    const summary = reactionSummary(malformed, 'alice');
    assert.equal(summary.length, 5); assert.ok(summary.every(reaction => reaction.count === 0 && reaction.selected === false));
  }
  const stored = Object.assign(Object.create({ alice: 'like' }), { bob: 'sad', charlie: 'unknown', dana: 'sad' });
  const summary = reactionSummary(stored, 'alice');
  assert.equal(summary.find(reaction => reaction.id === 'sad').count, 2);
  assert.equal(summary.find(reaction => reaction.id === 'like').count, 0);
  assert.ok(summary.every(reaction => !reaction.selected));
});
