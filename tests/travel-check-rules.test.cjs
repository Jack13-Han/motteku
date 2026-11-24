// Run only with the local demo Firestore emulator; never uses production data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/);
const root = `http://${host}/v1/projects/demo-motteku/databases/(default)/documents`;
const token = uid => [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/demo-motteku', aud: 'demo-motteku', sub: uid, user_id: uid, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: 'custom', identities: {} } })).toString('base64url'), ''].join('.');
function encode(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([key, value]) => [key, encode(value)])) } };
}
const headers = uid => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${uid === 'emulator-admin' ? 'owner' : token(uid)}` });
async function write(uid, values) {
  return fetch(`${root}:commit`, { method: 'POST', headers: headers(uid), body: JSON.stringify({ writes: values.map(([path, value]) => ({ update: { name: `projects/demo-motteku/databases/(default)/documents/${path}`, fields: encode(value).mapValue.fields } })) }), signal: AbortSignal.timeout(15000) });
}
const allowed = async (response, label) => assert.equal(response.status, 200, `${label}: ${await response.text()}`);
const denied = async (response, label) => assert.equal(response.status, 403, `${label}: ${await response.text()}`);

test('travel check rules isolate snapshots, enforce own-item edits and bag selection, and block unresolved completion', async () => {
  const scope = `travel-${randomUUID()}`, parent = `packingTrips/${scope}`, checkpoint = `${parent}/travelCheckpoints/return-home`;
  const owner = 'check-owner', member = 'check-member', other = 'check-other', admin = 'check-admin';
  await allowed(await write('emulator-admin', [
    [`sharedTrips/${scope}`, { ownerUid: owner, inviteCode: 'invite' }],
    ...[owner, member, other, admin].map(uid => [`sharedTrips/${scope}/members/${uid}`, { uid, name: uid }]),
    [parent, { sourceTripId: scope, roomId: scope, ownerUid: owner, adminUids: [admin], bags: [{ id: 'blue', name: 'Blue bag' }], bagIds: ['blue'], createdAt: new Date() }],
    [`${parent}/members/m1`, { id: 'm1', uid: member, name: 'Hnin', active: true }],
    [`${parent}/members/m2`, { id: 'm2', uid: other, name: 'Phyu', active: true }],
    [`${parent}/itemAssignments/source`, { id: 'source', status: 'packed' }],
  ]), 'seed isolated demo trip');
  const upcoming = { id: 'return-home', tripId: scope, type: 'returnHome', fromLocation: '', toLocation: '', scheduledAt: '2026-11-15T01:00:00.000Z', notificationMinutesBefore: 60, status: 'upcoming', completedAt: '', snapshotAt: '', archived: false, items: {}, unresolvedCount: 0, missingCount: 0, lastUpdatedItemId: '' };
  // Existing trips may have neither collection nor plan. Authorized absence is not permission denied.
  const empty = await fetch(`${root}/${parent}/travelCheckpoints`, { headers: headers(owner) });
  assert.equal(empty.status, 200, await empty.clone().text());
  assert.equal((await empty.json()).documents?.length || 0, 0);
  const missingPlan = await fetch(`${root}/${parent}/travelCheckPlans/current`, { headers: headers(member) });
  assert.equal(missingPlan.status, 404, await missingPlan.text());
  await denied(await fetch(`${root}/${parent}/travelCheckpoints`, { headers: headers('outsider') }), 'outsiders cannot list even an empty collection');
  await denied(await write(member, [[checkpoint, upcoming]]), 'member cannot create a group check');
  await allowed(await write(owner, [[checkpoint, upcoming]]), 'owner creates mandatory return check');
  const plan = { accommodationMode: 'single', stays: [], returnDate: '2026-11-15', returnTime: '10:00', notificationMinutesBefore: 60 };
  await denied(await write(member, [[`${parent}/travelCheckPlans/current`, plan]]), 'members cannot edit the stay plan');
  await allowed(await write(admin, [[`${parent}/travelCheckPlans/current`, plan]]), 'admins manage stay plans');
  const item = (id, assigneeId) => ({ id, sourceItemId: 'shoes', sourceAssignmentId: id, itemName: 'Shoes', itemNameKey: '', itemType: 'personal', assigneeId, assigneeName: assigneeId, quantity: 1, originalBagId: 'blue', originalBagName: 'Blue bag', currentBagId: '', currentBagName: '', status: 'unchecked', updatedAt: '2026-11-14T00:00:00.000Z' });
  let active = { ...upcoming, status: 'inProgress', snapshotAt: '2026-11-14T00:00:00.000Z', items: { a: item('a', 'm1'), b: item('b', 'm2') }, unresolvedCount: 2 };
  const lazyPath = `${parent}/travelCheckpoints/move-hotel`;
  const lazy = { ...active, id: 'move-hotel', type: 'transition' };
  await denied(await write(member, [[lazyPath, lazy]]), 'members cannot lazily create snapshots');
  await denied(await write(owner, [[lazyPath, { ...lazy, unresolvedCount: 0 }]]), 'lazy creation cannot forge resolved counts');
  await allowed(await write(owner, [[lazyPath, lazy]]), 'explicit Start atomically creates a previously absent snapshot');
  await allowed(await write(owner, [[checkpoint, active]]), 'owner freezes departure snapshot');
  await denied(await fetch(`${root}/${checkpoint}`, { headers: headers('outsider') }), 'outsiders cannot read snapshots');
  const change = (value, key, patch, unresolvedCount, missingCount = 0) => ({ ...value, lastUpdatedItemId: key, unresolvedCount, missingCount, items: { ...value.items, [key]: { ...value.items[key], ...patch } } });
  await denied(await write(member, [[checkpoint, change(active, 'b', { status: 'usedUp' }, 1)]]), 'member cannot check someone else item');
  await denied(await write(member, [[checkpoint, change(active, 'a', { status: 'packed' }, 1)]]), 'packed requires an existing current bag');
  await denied(await write(member, [[checkpoint, change(active, 'a', { status: 'packed', currentBagId: 'forged', currentBagName: 'Fake' }, 1)]]), 'unknown bag rejected');
  await denied(await write(member, [[checkpoint, change(active, 'a', { status: 'usedUp', assigneeId: 'm2' }, 1)]]), 'snapshot identity cannot be changed');
  await denied(await write(member, [[checkpoint, change(active, 'a', { status: 'usedUp' }, 0)]]), 'cannot forge the completion counter');
  active = change(active, 'a', { status: 'packed', currentBagId: 'blue', currentBagName: 'Blue bag' }, 1);
  await allowed(await write(member, [[checkpoint, active]]), 'own packed item with a bag accepted');
  await denied(await write(owner, [[checkpoint, { ...active, status: 'completed', completedAt: 'now' }]]), 'unchecked items prevent completion');
  active = change(active, 'b', { status: 'missing' }, 1, 1);
  await allowed(await write(other, [[checkpoint, active]]), 'own missing item remains unresolved');
  await denied(await write(owner, [[checkpoint, { ...active, status: 'completed', completedAt: 'now' }]]), 'missing item prevents completion');
  active = change(active, 'b', { status: 'leaveBehind' }, 0);
  await allowed(await write(other, [[checkpoint, active]]), 'intentional leave behind resolves the item');
  await denied(await write(member, [[checkpoint, { ...active, status: 'completed', completedAt: 'now' }]]), 'only a manager can complete the group check');
  active = { ...active, status: 'completed', completedAt: '2026-11-14T02:00:00.000Z', lastUpdatedItemId: '' };
  await allowed(await write(admin, [[checkpoint, active]]), 'admin completes a fully resolved check');
  await denied(await write(member, [[checkpoint, { ...change(active, 'a', { status: 'missing' }, 1, 1), status: 'inProgress' }]]), 'completed snapshots cannot be changed');
  const departure = await fetch(`${root}/${parent}/itemAssignments/source`, { headers: headers(owner) });
  assert.equal((await departure.json()).fields.status.stringValue, 'packed');
});
