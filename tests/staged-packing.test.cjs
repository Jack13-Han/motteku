const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, '../lib', relative + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, name => name.startsWith('./') ? load(name.slice(2)) : require(name));
  cache.set(file, exports); return exports;
}
const { personalPackingReady } = load('stagedPacking');
const ids = ['alice', 'bob'];
const personal = { id: 'passport', tripId: 'trip', type: 'personal', name: 'Passport', quantity: 1, targetMemberIds: ids, createdBy: 'alice' };
const row = (id, patch = {}) => ({ id: `passport_${id}`, itemId: 'passport', tripId: 'trip', memberId: id, status: 'ready', ...patch });
const data = patch => ({ ownerUid: 'alice', adminUids: [], bags: [], members: ids.map(id => ({ id, uid: id, name: id, active: true })), items: [personal], assignments: [row('alice'), row('bob', { status: 'packed' })], ...patch });

test('all canonical personal targets must be ready or packed; shared status is a later step', () => {
  assert.equal(personalPackingReady(data(), ids, true), true);
  assert.equal(personalPackingReady(data({ assignments: [row('alice'), row('bob', { status: 'not_ready' })] }), ids, true), false);
  const shared = { ...personal, id: 'tent', type: 'shared', targetMemberIds: [] };
  assert.equal(personalPackingReady(data({ items: [personal, shared], assignments: [row('alice'), row('bob'), { id: 'tent_unit_1', itemId: 'tent', memberId: '', status: 'not_ready', unitNumber: 1 }] }), ids, true), true);
});

test('cached, unloaded, empty or changed rosters never enable the shared phase', () => {
  assert.equal(personalPackingReady(data(), ids, false), false);
  assert.equal(personalPackingReady(null, ids, true), false);
  assert.equal(personalPackingReady(data({ members: [] }), [], true), false);
  assert.equal(personalPackingReady(data(), [...ids, 'new'], true), false);
  assert.equal(personalPackingReady(data(), ['alice', 'alice'], true), false);
  assert.equal(personalPackingReady(data({ members: [{ id: 'alice', uid: 'alice', name: 'Alice' }, { id: 'bob', uid: 'bob', name: 'Bob', active: false }] }), ids, true), false);
});

test('missing, duplicate, wrongly identified or malformed current assignments block advancement', () => {
  for (const assignments of [
    [row('alice')],
    [row('alice'), row('bob'), row('bob')],
    [row('alice'), row('bob', { id: 'incorrect' })],
    [row('alice'), row('bob', { memberId: 'alice' })],
    [row('alice'), row('bob', { itemId: 'other' })],
    [row('alice'), row('bob', { status: 'invalid' })],
  ]) assert.equal(personalPackingReady(data({ assignments }), ids, true), false);
});

test('retained history is ignored while inactive or duplicated targets must be reconciled', () => {
  assert.equal(personalPackingReady(data({ assignments: [row('alice'), row('bob'), row('former', { status: 'not_ready' })] }), ids, true), true);
  assert.equal(personalPackingReady(data({ items: [{ ...personal, targetMemberIds: ['alice', 'former'] }] }), ids, true), false);
  assert.equal(personalPackingReady(data({ items: [{ ...personal, targetMemberIds: ['alice', 'alice'] }] }), ids, true), false);
  assert.equal(personalPackingReady(data({ items: [{ ...personal, targetMemberIds: [] }] }), ids, true), false);
});

test('trips with no personal templates may proceed after their confirmed roster has synced', () => {
  assert.equal(personalPackingReady(data({ items: [], assignments: [] }), ids, true), true);
  assert.equal(personalPackingReady(data({ items: [], assignments: [] }), ids, false), false);
  assert.equal(personalPackingReady(data({ items: [], assignments: [] }), ['alice'], true), false);
  assert.equal(personalPackingReady(data({ items: [{ ...personal, targetMemberIds: ['alice'] }], assignments: [row('alice')] }), ids, true), true, 'An intentionally targeted personal item requires only its listed targets');
});
