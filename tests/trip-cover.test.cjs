const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'components/TripCoverImage.tsx'), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const helpers = {};
new Function('exports', compile(fs.readFileSync(path.join(root, 'lib/tripCover.ts'), 'utf8')))(helpers);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const textOf = node => Array.isArray(node) ? node.map(textOf).join(' ') : node && typeof node === 'object' ? textOf(node.props?.children) : node == null ? '' : String(node);

function harness(options = {}) {
  const slots = [], effects = [], calls = [], changes = [], images = [], imageRequests = [];
  const auth = { currentUser: { uid: 'alice' } };
  let props = { trip: { id: 'first', location: 'Osaka, Japan', type: 'Camping' }, accountId: 'alice', ...options.props };
  let index = 0, dirty = false, pending = [], tree, unmounted = false, writesAfterUnmount = 0;
  const react = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], value => { if (unmounted) { writesAfterUnmount++; return; } const next = typeof value === 'function' ? value(slots[slot]) : value; if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; } }]; },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useMemo(fn, dependencies) { const slot = index++, old = slots[slot]; if (!old || dependencies.some((value, n) => !Object.is(value, old.dependencies[n]))) slots[slot] = { dependencies, value: fn() }; return slots[slot].value; },
    useEffect(fn, dependencies) { const slot = index++, old = effects[slot]; if (!old || dependencies.some((value, n) => !Object.is(value, old.dependencies[n]))) pending.push({ slot, fn, dependencies }); },
  };
  const jsx = (type, props) => {
    if (props?.ref && !props.ref.current) props.ref.current = type === 'dialog' ? { close() {}, showModal() {} } : { click() {} };
    return { type, props: props || {} };
  };
  class MockImage {
    constructor() { images.push(this); }
    set src(value) { this.url = value; imageRequests.push(value); }
    get src() { return this.url; }
  }
  const sdk = {
    ref: (_storage, objectPath) => ({ path: objectPath }),
    async uploadBytes(object, file, metadata) { calls.push({ type: 'upload', path: object.path, metadata }); if (options.upload) await options.upload(object, file); },
    async getDownloadURL(object) { calls.push({ type: 'url', path: object.path }); return options.url ? options.url(object) : 'https://example.test/uploaded.webp'; },
  };
  const stubs = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': { ImagePlus: 'ImagePlus' }, 'firebase/storage': sdk,
    '@/lib/firebase': { auth, storage: options.storage === false ? null : {} },
    '@/lib/i18n': { useLanguage: () => ({ t: value => value }) }, '@/lib/tripCover': helpers,
  };
  const exports = {};
  const bitmap = async file => { calls.push({ type: 'decode' }); if (options.decode) await options.decode(file); return { close() { calls.push({ type: 'closeBitmap' }); } }; };
  new Function('exports', 'require', 'Image', 'createImageBitmap', 'crypto', compile(source))(exports, name => { if (!(name in stubs)) throw Error('Unexpected import ' + name); return stubs[name]; }, MockImage, bitmap, { randomUUID: () => 'photo-id' });
  function render() {
    let rounds = 0;
    do {
      if (++rounds > 20) throw Error('Render did not stabilize');
      index = 0; dirty = false; pending = [];
      const tripId = props.trip.id;
      tree = exports.default({ ...props, onChange: cover => changes.push({ tripId, cover }) });
      for (const effect of pending) { effects[effect.slot]?.cleanup?.(); effects[effect.slot] = { dependencies: effect.dependencies, cleanup: effect.fn() }; }
    } while (dirty);
    return tree;
  }
  function nodes() { const out = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; out.push(node); visit(node.props?.children); } visit(tree); return out; }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, 'Expected rendered control'); return node; };
  const fileInput = () => find(node => node.type === 'input' && node.props.type === 'file');
  const triggerFile = file => fileInput().props.onChange({ currentTarget: { files: file ? [file] : [], value: 'selected' } });
  const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); render(); };
  const cleanup = () => { effects.forEach(effect => effect?.cleanup?.()); unmounted = true; };
  render();
  return { auth, calls, changes, images, imageRequests, render, find, triggerFile, flush, cleanup,
    text: () => textOf(tree), changeProps: patch => { props = { ...props, ...patch }; render(); },
    button: label => find(node => node.type === 'button' && textOf(node) === label),
    background: () => find(node => node.props.className === 'travel-hero-cover').props.style?.backgroundImage,
    afterUnmount: () => writesAfterUnmount,
  };
}
const valid = { type: 'image/webp', size: 1000 };

test('missing or malformed destination and trip type values safely select a bundled cover', () => {
  for (const value of [undefined, null, 42, true, {}, []]) {
    assert.equal(helpers.findDestinationCover(value), undefined);
    assert.deepEqual(helpers.tripCoverCandidates({ location: value, type: value }), [helpers.defaultTripCover]);
    assert.match(helpers.getDestinationCoverImage(value, 'Camping').coverImageUrl, /camping.webp$/);
  }
});

test('malformed uploaded URLs and attribution cannot become image or React child values', () => {
  for (const coverImageUrl of [undefined, null, 42, {}, [], 'javascript:alert(1)']) {
    assert.equal(helpers.tripCoverCandidates({ location: 'Osaka', type: 'Camping', coverImageSource: 'uploaded', coverImageUrl })[0].coverImageSource, 'destination');
  }
  const cover = helpers.tripCoverCandidates({ location: '', type: '', coverImageSource: 'uploaded', coverImageUrl: 'https://example.test/image.webp', coverImageAttribution: { unexpected: true } })[0];
  assert.equal(cover.coverImageSource, 'uploaded');
  assert.equal(cover.coverImageAttribution, undefined);
});

test('failed cover preloads fall back through destination, trip type and bundled default', () => {
  const ui = harness();
  const image = ui.images[0];
  assert.match(image.src, /osaka.webp$/);
  image.onerror(); assert.match(image.src, /camping.webp$/);
  image.onerror(); assert.match(image.src, /default.webp$/);
  image.onload(); ui.render();
  assert.match(ui.background(), /default.webp/); assert.match(ui.text(), /Could not load the image/);
  assert.equal(ui.imageRequests.length, 3);
  ui.cleanup(); assert.equal(image.onload, null); assert.equal(image.onerror, null);
});

test('choosing local covers works without Storage and does not make upload requests', () => {
  const ui = harness({ storage: false, props: { accountId: undefined } });
  assert.equal(ui.button('Upload my photo').props.disabled, true);
  ui.button('Find a photo for this location').props.onClick(); ui.render();
  assert.match(ui.changes[0].cover.coverImageUrl, /osaka.webp$/);
  ui.button('Use default image').props.onClick(); ui.render();
  assert.equal(ui.changes[1].cover.coverImageSource, 'default');
  assert.deepEqual(ui.calls, []); ui.cleanup();
});

test('invalid MIME, empty and oversized files are rejected before decoding or uploading', async () => {
  const ui = harness();
  for (const file of [{ type: 'image/svg+xml', size: 100 }, { type: 'image/jpeg', size: 0 }, { type: 'image/png', size: helpers.coverImageSizeLimit + 1 }]) {
    ui.triggerFile(file); await ui.flush(); assert.match(ui.text(), /up to 5 MB/);
  }
  assert.deepEqual(ui.calls, []); assert.deepEqual(ui.changes, []); ui.cleanup();
});

test('a malformed image cannot upload and a valid upload uses only the active account/trip path', async () => {
  let malformed = true;
  const ui = harness({ decode: () => { if (malformed) throw Error('Invalid bitmap'); } });
  ui.triggerFile(valid); await ui.flush();
  assert.match(ui.text(), /Could not upload/); assert.equal(ui.calls.some(call => call.type === 'upload'), false);
  malformed = false; ui.triggerFile(valid); await ui.flush();
  assert.deepEqual(ui.calls.find(call => call.type === 'upload'), { type: 'upload', path: 'users/alice/tripCovers/first/photo-id', metadata: { contentType: 'image/webp' } });
  assert.deepEqual(ui.changes, [{ tripId: 'first', cover: { coverImageUrl: 'https://example.test/uploaded.webp', coverImageSource: 'uploaded' } }]);
  assert.equal(ui.button('Upload my photo').props.disabled, false); ui.cleanup();
});

test('an in-flight upload ignores duplicate selections and releases controls after failure for retry', async () => {
  const gate = deferred(); let fail = true;
  const ui = harness({ upload: async () => { if (fail) await gate.promise; } });
  ui.triggerFile(valid); ui.triggerFile(valid); await ui.flush();
  assert.equal(ui.calls.filter(call => call.type === 'upload').length, 1);
  assert.equal(ui.button('Upload my photo').props.disabled, true);
  gate.reject(Error('Upload failed')); await ui.flush();
  assert.match(ui.text(), /Could not upload/); assert.equal(ui.button('Upload my photo').props.disabled, false);
  fail = false; ui.triggerFile(valid); await ui.flush(); assert.equal(ui.changes.length, 1); ui.cleanup();
});

test('an account change during upload never requests a download URL or updates the previous account', async () => {
  const gate = deferred(); const ui = harness({ upload: () => gate.promise });
  ui.triggerFile(valid); await ui.flush();
  ui.auth.currentUser = { uid: 'bob' }; gate.resolve(); await ui.flush();
  assert.equal(ui.calls.some(call => call.type === 'url'), false); assert.deepEqual(ui.changes, []);
  assert.equal(ui.button('Upload my photo').props.disabled, false); ui.cleanup();
});

test('changing trips cancels the old completion without clearing a newer upload state', async () => {
  const oldGate = deferred(), newGate = deferred();
  const ui = harness({ upload: object => object.path.includes('/first/') ? oldGate.promise : newGate.promise });
  ui.triggerFile(valid); await ui.flush();
  ui.changeProps({ trip: { id: 'second', location: 'Tokyo', type: 'Camping' } });
  ui.triggerFile(valid); await ui.flush();
  oldGate.resolve(); await ui.flush();
  assert.deepEqual(ui.changes, []); assert.equal(ui.button('Upload my photo').props.disabled, true);
  newGate.resolve(); await ui.flush();
  assert.equal(ui.changes.length, 1); assert.equal(ui.changes[0].tripId, 'second'); ui.cleanup();
});

test('an upload finishing after unmount cannot update cover state or call its old change callback', async () => {
  const gate = deferred(), ui = harness({ upload: () => gate.promise });
  ui.triggerFile(valid); await ui.flush(); ui.cleanup(); gate.resolve(); await ui.flush();
  assert.deepEqual(ui.changes, []); assert.equal(ui.afterUnmount(), 0);
});
