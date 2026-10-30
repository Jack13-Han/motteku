// Run only against the local Firestore emulator. No production project is used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const project = 'demo-motteku';
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
const root = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const room = `rules-${randomUUID()}`;
const prefix = `packingTrips/${room}`;
const owner = 'organizer';
const value = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(value) } } : { mapValue: { fields: fields(v) } };
const fields = object => Object.fromEntries(Object.entries(object).map(([k, v]) => [k, value(v)]));
const token = uid => [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, user_id: uid, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'custom', identities: {} } })).toString('base64url'), ''].join('.');
async function get(path, uid) {
  return fetch(`${root}/${path}`, { headers: { Authorization: `Bearer ${token(uid)}` } });
}
async function commit(uid, writes) {
  return fetch(`${root}:commit`, { method: 'POST', headers: { Authorization: `Bearer ${uid === 'emulator-admin' ? 'owner' : token(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
}
function write(path, data, timestamps = [], mask) {
  return { update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields: fields(data) }, ...(mask ? { updateMask: { fieldPaths: mask } } : {}), ...(timestamps.length ? { updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) };
}
async function allowed(response, label) { assert.equal(response.status, 200, `${label}: ${await response.text()}`); }
async function denied(response, label) { assert.equal(response.status, 403, `${label}: ${await response.text()}`); }
const assignments = () => Array.from({ length: 5 }, (_, i) => ({ id: `shoes_m${i}`, tripId: room, itemId: 'shoes', memberId: `m${i}`, status: 'not_ready', bagId: '' }));

await allowed(await commit('emulator-admin', [
  write(`sharedTrips/${room}`, { ownerUid: owner, inviteCode: 'test-invite' }),
  ...[owner, 'admin', ...Array.from({ length: 5 }, (_, i) => `user${i}`)].map(uid => write(`sharedTrips/${room}/members/${uid}`, { uid, name: uid, inviteCode: 'test-invite' })),
]), 'seed shared room');

await denied(await commit(owner, [
  write(prefix, { sourceTripId: 'local-trip', roomId: room, ownerUid: owner, adminUids: ['admin'], bags: [{ id: 'black', name: '黒いバッグ' }, { id: 'blue', name: '青いバッグ' }], bagIds: ['black', 'blue'] }, ['createdAt']),
]), 'creation requires empty admins');

await allowed(await commit(owner, [
  write(prefix, { sourceTripId: 'local-trip', roomId: room, ownerUid: owner, adminUids: [], bags: [{ id: 'black', name: '黒いバッグ' }, { id: 'blue', name: '青いバッグ' }], bagIds: ['black', 'blue'] }, ['createdAt']),
  ...Array.from({ length: 5 }, (_, i) => write(`${prefix}/members/m${i}`, { id: `m${i}`, name: `Member ${i}`, uid: `user${i}` })),
]), 'initialize roster');
await allowed(await commit(owner, [write(prefix, { adminUids: ['admin'] }, [], ['adminUids'])]), 'grant admin');
const item = (id, type, quantity, targets) => ({ id, tripId: room, name: id, type, quantity, targetMemberIds: targets, createdBy: owner });
await allowed(await commit(owner, [
  write(`${prefix}/items/shoes`, item('shoes', 'personal', 1, Array.from({ length: 5 }, (_, i) => `m${i}`)), ['createdAt', 'updatedAt']),
  ...assignments().map(a => write(`${prefix}/itemAssignments/${a.id}`, a, ['updatedAt'])),
]), 'create five personal assignments');
const update = (id, patch) => write(`${prefix}/itemAssignments/${id}`, patch, ['updatedAt'], Object.keys(patch));
await allowed(await commit('user0', [update('shoes_m0', { status: 'packed', bagId: 'black' })]), 'own status');
await denied(await commit('user0', [update('shoes_m1', { status: 'packed' })]), 'another member');
await denied(await commit('user0', [update('shoes_m0', { memberId: 'm1' })]), 'personal reassignment');
await denied(await commit('user0', [update('shoes_m0', { status: 'invalid' })]), 'invalid status');
await denied(await commit('user0', [update('shoes_m0', { bagId: 'unknown' })]), 'unknown bag');
for (let i = 0; i < 5; i++) {
  const response = await get(`${prefix}/itemAssignments/shoes_m${i}`, 'user0');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fields.status.stringValue, i === 0 ? 'packed' : 'not_ready');
}
await allowed(await commit('admin', [update('shoes_m1', { status: 'ready' })]), 'admin edit');
await allowed(await commit(owner, [update('shoes_m2', { status: 'packed' })]), 'owner edit');
await denied(await get(`${prefix}/items/shoes`, 'outsider'), 'outsider read');
await denied(await commit('outsider', [update('shoes_m0', { status: 'ready' })]), 'outsider write');
await allowed(await commit(owner, [
  write(`${prefix}/items/tent`, item('tent', 'shared', 2, []), ['createdAt', 'updatedAt']),
  ...[0, 2].map((member, i) => write(`${prefix}/itemAssignments/tent_unit_${i + 1}`, { id: `tent_unit_${i + 1}`, tripId: room, itemId: 'tent', memberId: `m${member}`, unitNumber: i + 1, status: 'not_ready', bagId: '' }, ['updatedAt'])),
]), 'shared units');
await allowed(await commit('user0', [update('tent_unit_1', { status: 'packed', bagId: 'black' })]), 'assignee edit');
await denied(await commit('user0', [update('tent_unit_2', { status: 'packed' })]), 'other shared unit');
await denied(await commit('user0', [update('tent_unit_1', { memberId: 'm1' })]), 'assignee reassign');
await allowed(await commit('admin', [update('tent_unit_2', { memberId: 'm1', bagId: 'blue' })]), 'admin reassign');
await denied(await commit('user2', [update('tent_unit_2', { status: 'packed' })]), 'former assignee');
await allowed(await commit('user1', [update('tent_unit_2', { status: 'packed' })]), 'new assignee');
const targets = Array.from({ length: 5 }, (_, i) => `m${i}`);
const towelTemplate = { id: 'towel', nameKey: 'Towel', category: 'General', type: 'personal', quantityRule: 'per_person', quantityPerPerson: 2, unitKey: 'unit.sheets' };
const tentTemplate = { id: 'tent', nameKey: 'Tent', category: 'General', type: 'shared', quantityRule: 'capacity', capacityPerItem: 3, unitKey: 'unit.items' };
await allowed(await commit(owner, [write(`${prefix}/items/template-towel`, { ...item('template-towel', 'personal', 10, targets), name: 'Towel', customName: false, template: towelTemplate }, ['createdAt', 'updatedAt'])]), 'template personal quantity is member count times allocation');
await allowed(await commit(owner, targets.map(memberId => write(`${prefix}/itemAssignments/template-towel_${memberId}`, { id: `template-towel_${memberId}`, tripId: room, itemId: 'template-towel', memberId, status: 'not_ready', bagId: '' }, ['updatedAt']))), 'five personal allocations');
await allowed(await commit('user0', [update('template-towel_m0', { status: 'packed', bagId: 'black' })]), 'member checks own two towels');
const itemUpdate = (id, patch) => write(`${prefix}/items/${id}`, patch, ['updatedAt'], Object.keys(patch));
await denied(await commit('user0', [itemUpdate('template-towel', { quantity: 12, targetMemberIds: [...targets, 'm5'] })]), 'member cannot change calculated targets');
await denied(await commit(owner, [itemUpdate('template-towel', { quantity: 11 })]), 'reject inconsistent personal quantity');
await denied(await commit(owner, [itemUpdate('template-towel', { template: { ...towelTemplate, quantityPerPerson: 3 }, quantity: 15 })]), 'template rules are immutable');
await allowed(await commit(owner, [write(`${prefix}/members/m5`, { id: 'm5', name: 'Sixth traveler', uid: '', active: true })]), 'register sixth traveler');
await allowed(await commit(owner, [itemUpdate('template-towel', { quantity: 12, targetMemberIds: [...targets, 'm5'] })]), 'recalculate personal requirement');
await allowed(await commit(owner, [write(`${prefix}/itemAssignments/template-towel_m5`, { id: 'template-towel_m5', tripId: room, itemId: 'template-towel', memberId: 'm5', status: 'not_ready', bagId: '' }, ['updatedAt'])]), 'create only new personal checklist');
const savedTowel = await (await get(`${prefix}/itemAssignments/template-towel_m0`, owner)).json();
assert.equal(savedTowel.fields.status.stringValue, 'packed');
assert.equal(savedTowel.fields.bagId.stringValue, 'black');

await allowed(await commit(owner, [write(`${prefix}/items/template-tent`, { ...item('template-tent', 'shared', 2, []), name: 'Tent', template: tentTemplate, customName: false }, ['createdAt', 'updatedAt'])]), 'capacity-based shared item');
await allowed(await commit(owner, [1, 2].map(unitNumber => write(`${prefix}/itemAssignments/template-tent_unit_${unitNumber}`, { id: `template-tent_unit_${unitNumber}`, tripId: room, itemId: 'template-tent', memberId: '', unitNumber, status: 'not_ready', bagId: '' }, ['updatedAt']))), 'shared units may start unassigned');
await allowed(await commit(owner, [update('template-tent_unit_2', { memberId: 'm4', status: 'packed', bagId: 'blue' })]), 'assign and pack second unit');
await allowed(await commit(owner, [write(`${prefix}/members/m4`, { active: false }, [], ['active'])]), 'confirmed removal deactivates member');
await denied(await commit('user4', [update('template-tent_unit_2', { status: 'ready' })]), 'removed assignee cannot edit');
await denied(await commit('user4', [update('template-towel_m4', { status: 'ready' })]), 'removed personal member cannot edit');
await denied(await commit(owner, [update('tent_unit_1', { memberId: 'm4' })]), 'cannot assign another unit to inactive member');
await allowed(await commit(owner, [itemUpdate('template-tent', { quantity: 1 }), itemUpdate('template-towel', { quantity: 6, targetMemberIds: targets.slice(0, 3) })]), 'shrink requirements without deleting checklists');
const retained = await (await get(`${prefix}/itemAssignments/template-tent_unit_2`, owner)).json();
assert.equal(retained.fields.status.stringValue, 'packed');
assert.equal(retained.fields.memberId.stringValue, 'm4');
assert.equal(retained.fields.bagId.stringValue, 'blue');
await allowed(await get(`${prefix}/itemAssignments/template-towel_m4`, owner), 'removed checklist retained');
await allowed(await commit(owner, [itemUpdate('template-tent', { quantity: 2 })]), 'reuse retained unit when group grows');
await allowed(await commit(owner, [update('template-tent_unit_2', { memberId: 'm0' })]), 'reassign retained unit');
console.log('Packing security rules and generated quantity checks passed.');
