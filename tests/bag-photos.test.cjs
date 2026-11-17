const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));
const bag = (overrides = {}) => ({ id: 'bag-one', name: 'Blue bag', photoUrl: 'sharedTrips/room-one/bags/photo.jpg', verified: false, ...overrides });

// Execute actual component effects and event handlers. Firebase transports are mocked;
// no production account, bucket or browser is accessed by these tests.
function harness(config = {}) {
  const notices = [], savedBags = [], changedItems = [], reads = [], uploads = [], created = [], revoked = [], listeners = [], shared = [];
  let props = { bags: [bag()], items: [], chatId: 'room-one', userUid: 'alice', onNotice: message => notices.push(message), onBagsChange: value => savedBags.push(value), onItemChange: (...args) => changedItems.push(args), onSharedPlanChange: (...args) => shared.push(args), ...config.props };
  let index = 0, dirty = false, tree, unmounted = false, afterUnmount = 0;
  const slots = [], effects = [];
  const react = {
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { if (unmounted) { afterUnmount++; return; } slots[at] = typeof value === 'function' ? value(slots[at]) : value; dirty = true; }]; },
    useRef(initial) { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(effect, deps) { const at = index++, old = slots[at]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: effect() }; }); },
  };
  const jsx = (type, props, key) => ({ type, props: { ...(props || {}), ...(key === undefined ? {} : { key }) } });
  class BrowserURL extends URL {
    static createObjectURL(value) { const url = `blob:test-${created.length + 1}`; created.push({ url, value }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class ImageMock { set src(_value) { queueMicrotask(() => this.onload?.()); } }
  const firestore = {
    doc: (...parts) => ({ path: parts.filter(part => typeof part === 'string').join('/') }),
    onSnapshot(ref, next, failure) { const listener = { ref, next, failure, active: true }; listeners.push(listener); next({ data: () => ({}) }); return () => { listener.active = false; }; },
    setDoc: async () => {},
  };
  const transport = {
    ref: (_storage, value) => ({ path: value }),
    getBlob(ref) { const result = deferred(); reads.push({ ref, result }); return result.promise; },
    uploadBytes: async (ref, blob, metadata) => { uploads.push({ ref, blob, metadata }); return { ref }; },
  };
  const cache = new Map();
  function local(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    assert.equal(compiled.diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0, 'Component must have valid TypeScript/JSX syntax');
    const code = compiled.outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: load, URL: BrowserURL, Image: ImageMock, console, queueMicrotask, crypto: { randomUUID: () => 'new-bag' }, document: { getElementById: () => ({ click() {} }), createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: done => done({ type: 'image/jpeg' }) }) } }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  function load(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'firebase/firestore') return firestore;
    if (name === 'firebase/storage') return transport;
    if (name === '@/lib/firebase') return { db: {}, storage: config.noStorage ? null : {} };
    if (name === '@/lib/bagPhotos') return local(path.join(root, 'lib/bagPhotos.ts'));
    if (name === '@/lib/i18n') return { useLanguage: () => ({ t: (key, values = {}) => (config.japanese ? 'JA:' : '') + key.replace(/\{(\w+)\}/g, (_, word) => String(values[word] ?? `{${word}}`)) }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_object, key) => String(key) });
    throw new Error('Unexpected import ' + name);
  }
  const component = local(path.join(root, 'components/BagPacking.tsx')).default;
  function render() { if (unmounted) return; let turns = 0; do { if (++turns > 30) throw new Error('Render loop'); dirty = false; index = 0; tree = component(props); while (effects.length) effects.shift()(); } while (dirty); }
  function nodes(node) { if (!arguments.length) node = tree; if (node == null || typeof node === 'boolean') return []; if (Array.isArray(node)) return node.flatMap(child => nodes(child)); if (typeof node !== 'object') return [node]; return [node, ...nodes(node.props?.children ?? null)]; }
  const find = predicate => { const value = nodes().find(node => typeof node === 'object' && predicate(node)); assert.ok(value, 'Expected component node'); return value; };
  async function flush() { for (let turn = 0; turn < 15; turn++) { await Promise.resolve(); render(); } }
  render();
  return { reads, uploads, created, revoked, notices, savedBags, changedItems, shared, listeners, find, nodes, flush, text: () => nodes().filter(value => typeof value === 'string').join(' '), images: () => nodes().filter(node => typeof node === 'object' && node.type === 'img'), setProps(next) { props = { ...props, ...next }; render(); }, unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); }, get afterUnmount() { return afterUnmount; }, helpers: load('@/lib/bagPhotos') };
}

test('photo references accept Storage paths, legacy Firebase URLs and demo images; malformed values stay safe', () => {
  const h = harness({ props: { bags: [] } }), { parseBagPhoto } = h.helpers;
  assert.deepEqual(plain(parseBagPhoto('sharedTrips/room-one/bags/a.jpg')), { kind: 'storage', value: 'sharedTrips/room-one/bags/a.jpg' });
  assert.deepEqual(plain(parseBagPhoto('https://firebasestorage.googleapis.com/v0/b/my-bucket/o/sharedTrips%2Froom-one%2Fbags%2Fa.jpg?alt=media&token=old')), { kind: 'storage', value: 'sharedTrips/room-one/bags/a.jpg' });
  assert.equal(parseBagPhoto('data:image/jpeg;base64,AAA').kind, 'inline');
  for (const value of [null, undefined, {}, 42, '', 'data:text/html,broken', 'https://other.test/file.jpg', 'https://firebasestorage.googleapis.com/v0/b/b/o/%broken']) assert.equal(parseBagPhoto(value), null);
  h.unmount();
});

test('real photo effect loads a protected Storage reference and revokes its browser URL on unmount', async () => {
  const h = harness(); assert.equal(h.reads.length, 1); assert.equal(h.reads[0].ref.path, 'sharedTrips/room-one/bags/photo.jpg');
  assert.match(h.text(), /Loading photo…/); assert.equal(h.images().length, 0);
  h.reads[0].result.resolve({ photo: 'one' }); await h.flush();
  assert.equal(h.images()[0].props.src, 'blob:test-1'); assert.equal(h.images()[0].props.alt, 'Photo of Blue bag');
  h.unmount(); assert.deepEqual(h.revoked, ['blob:test-1']);
});

test('legacy URLs normalize to Storage paths while demo data URLs do not issue Storage reads', async () => {
  const legacy = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/sharedTrips%2Froom-one%2Fbags%2Fa.jpg?alt=media&token=old';
  const inline = 'data:image/jpeg;base64,AAA';
  const h = harness({ props: { bags: [bag({ photoUrl: legacy }), bag({ id: 'demo', photoUrl: inline })] } });
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].ref.path, 'sharedTrips/room-one/bags/a.jpg');
  h.reads[0].result.resolve({}); await h.flush(); assert.equal(h.images().find(node => node.props.src === inline)?.props.src, inline);
  h.listeners[0].next({ data: () => ({ bagPlan: { bags: [bag({ photoUrl: legacy })], placements: [] } }) });
  assert.equal(h.shared[0][0][0].photoUrl, 'sharedTrips/room-one/bags/a.jpg'); h.unmount();
});

test('verification, bag name and callback identity changes do not download unchanged photos again', async () => {
  const h = harness(); h.reads[0].result.resolve({}); await h.flush();
  h.setProps({ bags: [bag({ name: 'Renamed', verified: true })], onNotice() {} }); await h.flush();
  assert.equal(h.reads.length, 1); assert.equal(h.revoked.length, 0); assert.equal(h.images()[0].props.src, 'blob:test-1'); assert.equal(h.images()[0].props.alt, 'Photo of Renamed'); h.unmount();
});

test('failed downloads replace loading with a translated failure and do not expose raw transport errors', async () => {
  const h = harness({ japanese: true }); h.reads[0].result.reject(new Error('private bucket request detail')); await h.flush();
  assert.match(h.text(), /JA:Bag photo unavailable/); assert.doesNotMatch(h.text(), /Loading photo|private bucket/);
  assert.equal(h.notices.length, 1); assert.doesNotMatch(h.notices[0], /private bucket/);
  assert.equal(h.find(node => node.type === 'button' && node.props['aria-label'] === 'JA:Delete Blue bag').props['aria-label'], 'JA:Delete Blue bag'); h.unmount();
  const missing = harness({ noStorage: true }); await missing.flush(); assert.equal(missing.reads.length, 0); assert.match(missing.text(), /Bag photo unavailable/); missing.unmount();
});

test('account or chat changes hide prior photos immediately and ignore late responses', async () => {
  const h = harness();
  h.setProps({ userUid: 'bob', chatId: 'room-two', bags: [bag({ photoUrl: 'sharedTrips/room-two/bags/new.jpg' })] });
  assert.equal(h.reads.length, 2); assert.equal(h.images().length, 0);
  h.reads[0].result.resolve({ old: true }); await h.flush(); assert.equal(h.created.length, 0); assert.equal(h.images().length, 0);
  h.reads[1].result.resolve({ current: true }); await h.flush(); assert.equal(h.images()[0].props.src, 'blob:test-1');
  h.setProps({ userUid: 'carol' }); assert.equal(h.images().length, 0); assert.deepEqual(h.revoked, ['blob:test-1']); h.unmount();
  h.reads[2].result.resolve({ afterUnmount: true }); await h.flush(); assert.equal(h.afterUnmount, 0); assert.equal(h.created.length, 1);
});

test('changing or deleting a photo revokes the previous URL and the real delete handler clears item placement', async () => {
  const h = harness({ props: { items: [{ id: 'item', name: 'Passport', bagId: 'bag-one' }] } });
  h.reads[0].result.resolve({}); await h.flush();
  h.setProps({ bags: [bag({ photoUrl: 'sharedTrips/room-one/bags/second.jpg' })] }); assert.deepEqual(h.revoked, ['blob:test-1']); assert.equal(h.images().length, 0);
  h.reads[1].result.resolve({}); await h.flush();
  h.find(node => node.type === 'button' && node.props['aria-label'] === 'Delete Blue bag').props.onClick();
  assert.deepEqual(plain(h.savedBags.at(-1)), []); assert.deepEqual(plain(h.changedItems), [['item', '', '']]);
  h.setProps({ bags: h.savedBags.at(-1) }); assert.deepEqual(h.revoked, ['blob:test-1', 'blob:test-2']); assert.equal(h.images().length, 0); h.unmount();
});

test('real image picker stores the Storage object path rather than a token download URL', async () => {
  const h = harness({ props: { bags: [bag({ photoUrl: '' })] } });
  await h.find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'photo.jpg' }] } }); await h.flush();
  assert.equal(h.uploads.length, 1); assert.match(h.uploads[0].ref.path, /^sharedTrips\/room-one\/bags\/bag-one-\d+\.jpg$/);
  assert.deepEqual(plain(h.uploads[0].metadata), { contentType: 'image/jpeg' });
  assert.equal(h.savedBags[0][0].photoUrl, h.uploads[0].ref.path); assert.equal(h.savedBags[0][0].verified, false); h.unmount();
});
