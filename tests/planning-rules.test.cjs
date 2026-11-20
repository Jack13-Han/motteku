// These mock credentials are accepted only by the local Firestore emulator.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Run through the local Firestore emulator only');
const project = 'demo-motteku';
const root = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const name = location => `projects/${project}/databases/(default)/documents/${location}`;
const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)]));
function encode(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: fields(value) } };
}
function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, decode(nested)]));
  return value;
}
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({
    iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, user_id: uid,
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'custom', identities: {} },
  })).toString('base64url'), ''].join('.');
}
const headers = uid => ({ 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid === 'emulator-admin' ? 'owner' : token(uid)}` } : {}) });
const commit = (uid, writes) => fetch(`${root}:commit`, { method: 'POST', headers: headers(uid), body: JSON.stringify({ writes }), signal: AbortSignal.timeout(15000) });
function write(location, data, timestamps = [], mask) {
  return { update: { name: name(location), fields: fields(data) },
    ...(mask ? { updateMask: { fieldPaths: mask } } : {}),
    ...(timestamps.length ? { updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
  };
}
async function expectStatus(response, expected, label) { assert.equal(response.status, expected, `${label}: ${await response.text()}`); }
const allowed = (response, label) => expectStatus(response, 200, label);
const denied = (response, label) => expectStatus(response, 403, label);
const get = (location, uid) => fetch(`${root}/${location}`, { headers: headers(uid), signal: AbortSignal.timeout(15000) });
async function read(location, uid) {
  const response = await get(location, uid);
  assert.equal(response.status, 200, await response.clone().text());
  return Object.fromEntries(Object.entries((await response.json()).fields).map(([key, value]) => [key, decode(value)]));
}
async function fixture(kind = 'chat') {
  const id = `planning-${randomUUID().replaceAll('-', '')}`;
  const owner = `owner-${randomUUID().slice(0, 8)}`, member = `member-${randomUUID().slice(0, 8)}`, admin = `admin-${randomUUID().slice(0, 8)}`;
  const base = `${kind === 'chat' ? 'sharedTrips' : 'trips'}/${id}`;
  const parent = kind === 'chat' ? { ownerUid: owner, inviteCode: 'testing' } : { ownerUid: owner, status: 'confirmed' };
  const writes = [write(base, parent)];
  for (const [uid, role] of [[owner, 'owner'], [member, 'member'], [admin, 'admin']]) writes.push(write(`${base}/${kind === 'chat' ? 'members' : 'tripMembers'}/${uid}`, { uid, name: uid, role }));
  writes.push(write(`packingTrips/${id}`, { ownerUid: owner, adminUids: [admin], roomId: kind === 'chat' ? id : '', ...(kind === 'trip' ? { managedTripId: id } : {}) }));
  for (const uid of [owner, member, admin]) writes.push(write(`packingTrips/${id}/members/${uid}`, { id: uid, uid, name: uid, active: true }));
  writes.push(write(`packingTrips/${id}/members/unlinked`, { id: 'unlinked', uid: '', name: 'Unlinked', active: true }));
  writes.push(write(`packingTrips/${id}/members/inactive`, { id: 'inactive', uid: member, name: 'Inactive', active: false }));
  writes.push(write(`packingTrips/${id}/items/passport`, { id: 'passport', name: 'Passport' }));
  await allowed(await commit('emulator-admin', writes), 'isolated planning fixture');
  const poll = suffix => `${base}/polls/${suffix}`;
  const payload = (uid = member) => ({ question: 'Where should we meet?', options: ['Osaka station', 'Namba station'], createdBy: uid, createdByName: 'Member', closed: false });
  const vote = (uid, value, target = 'main') => write(poll(target), { votes: value === undefined ? {} : { [uid]: value } }, [], [`votes.\`${uid}\``]);
  const requirement = itemId => `packingTrips/${id}/departureRequirements/${itemId}`;
  const confirmation = uid => `packingTrips/${id}/departureConfirmations/${uid}`;
  const acknowledgement = (uid = member) => ({ uid, memberId: uid, contextHash: 'a'.repeat(64) });
  return { id, kind, owner, member, admin, base, poll, payload, vote, requirement, confirmation, acknowledgement };
}

test('chat members create polls, vote once, change/remove own vote and retain concurrent votes', async () => {
  const h = await fixture();
  await allowed(await commit(h.member, [write(h.poll('main'), h.payload(), ['createdAt'])]), 'member creates poll');
  const responses = await Promise.all([commit(h.owner, [h.vote(h.owner, 0)]), commit(h.member, [h.vote(h.member, 1)])]);
  for (const response of responses) await allowed(response, 'concurrent own vote');
  assert.deepEqual((await read(h.poll('main'), h.owner)).votes, { [h.owner]: 0, [h.member]: 1 });
  await allowed(await commit(h.member, [h.vote(h.member, 0)]), 'change own vote');
  await allowed(await commit(h.member, [h.vote(h.member, undefined)]), 'remove own vote');
  assert.deepEqual((await read(h.poll('main'), h.owner)).votes, { [h.owner]: 0 });
});

test('poll schema rejects forged identities, untrimmed/duplicate/invalid options and initial votes', async () => {
  const h = await fixture();
  const invalid = [
    { createdBy: h.owner }, { question: '' }, { question: ' leading' }, { question: 'trailing\n' },
    { question: '\u3000Unicode whitespace' }, { createdByName: '\uFEFFMember' }, { question: 'a'.repeat(201) },
    { options: ['A'] }, { options: ['A', 'B', 'C', 'D', 'E', 'F'] }, { options: ['A', 'A'] },
    { options: [' A', 'B'] }, { options: ['A', ''] }, { options: ['A', 12] }, { options: ['A', 'B'.repeat(101)] },
    { createdByName: '' }, { votes: {} }, { votes: { [h.owner]: 0 } }, { closed: true }, { extra: true },
  ];
  for (const [index, patch] of invalid.entries()) await denied(await commit(h.member, [write(h.poll(`bad-${index}`), { ...h.payload(), ...patch }, ['createdAt'])]), `invalid poll ${index}`);
  await denied(await commit(h.member, [write(h.poll('client-time'), { ...h.payload(), createdAt: new Date() })]), 'server timestamp required');
  await allowed(await commit(h.member, [write(h.poll('unicode'), { ...h.payload(), question: '😀'.repeat(100), options: ['နံနက်', '午後'] }, ['createdAt'])]), '200 UTF-16 units are accepted');
  await denied(await commit(h.member, [write(h.poll('unicode-over'), { ...h.payload(), question: '😀'.repeat(101) }, ['createdAt'])]), '202 UTF-16 units exceed the question limit');
  await allowed(await commit(h.member, [write(h.poll('myanmar'), { ...h.payload(), question: 'က'.repeat(200) }, ['createdAt'])]), '200 Myanmar code units are accepted');
  await allowed(await commit(h.member, [write(h.poll('unicode-options'), { ...h.payload(), options: ['😀'.repeat(50), 'B'], createdByName: '😀'.repeat(40) }, ['createdAt'])]), 'emoji option and name at UTF-16 boundaries');
  await denied(await commit(h.member, [write(h.poll('unicode-options-over'), { ...h.payload(), options: ['😀'.repeat(51), 'B'] }, ['createdAt'])]), 'emoji option above boundary');
  await denied(await commit(h.member, [write(h.poll('unicode-name-over'), { ...h.payload(), createdByName: '😀'.repeat(41) }, ['createdAt'])]), 'emoji name above boundary');
});

test('vote changes cannot affect other voters, poll content, counts or use invalid indexes', async () => {
  const h = await fixture();
  await allowed(await commit(h.member, [write(h.poll('main'), h.payload(), ['createdAt'])]), 'create');
  await allowed(await commit(h.owner, [h.vote(h.owner, 1)]), 'owner vote');
  for (const value of [-1, 2, '0', 0.5, null, true]) await denied(await commit(h.member, [h.vote(h.member, value)]), 'invalid option index');
  await denied(await commit(h.member, [h.vote(h.owner, 0)]), 'cannot change other vote');
  await denied(await commit(h.member, [h.vote(h.owner, undefined)]), 'cannot remove other vote');
  await denied(await commit(h.member, [write(h.poll('main'), { votes: { [h.member]: 0 } }, [], ['votes'])]), 'cannot replace map losing another vote');
  for (const patch of [{ question: 'Changed' }, { options: ['X', 'Y'] }, { createdBy: h.owner }, { totalVotes: 100 }]) await denied(await commit(h.member, [write(h.poll('main'), patch, [], Object.keys(patch))]), 'immutable poll content');
  await denied(await commit(h.member, [{ delete: name(h.poll('main')) }]), 'poll deletion disabled');
});

test('creator or chat owner closes polls, and closed polls cannot receive votes or reopen', async () => {
  const h = await fixture();
  await allowed(await commit(h.member, [write(h.poll('main'), h.payload(), ['createdAt'])]), 'create');
  const close = target => write(h.poll(target), { closed: true }, ['closedAt'], ['closed']);
  await denied(await commit(h.admin, [close('main')]), 'chat member cannot close another poll');
  await allowed(await commit(h.owner, [close('main')]), 'chat owner closes');
  await denied(await commit(h.member, [h.vote(h.member, 0)]), 'closed vote denied');
  await denied(await commit(h.member, [write(h.poll('main'), { closed: false }, [], ['closed'])]), 'reopen denied');
  await allowed(await commit(h.member, [write(h.poll('own'), h.payload(), ['createdAt'])]), 'another poll');
  await allowed(await commit(h.member, [close('own')]), 'creator closes own poll');
});

test('poll reads and writes require membership in that specific scope, including dot UIDs', async () => {
  const h = await fixture();
  await allowed(await commit(h.member, [write(h.poll('main'), h.payload(), ['createdAt'])]), 'create');
  for (const uid of ['outsider', null]) {
    await denied(await get(h.poll('main'), uid), 'nonmember read');
    await denied(await commit(uid, [write(h.poll(`foreign-${uid}`), h.payload(uid), ['createdAt'])]), 'nonmember create');
    await denied(await commit(uid, [h.vote(uid || 'guest', 0)]), 'nonmember vote');
  }
  const dot = 'member.with.dot';
  await allowed(await commit('emulator-admin', [write(`${h.base}/members/${dot}`, { uid: dot })]), 'dot UID membership');
  await allowed(await commit(dot, [h.vote(dot, 1)]), 'literal dot UID vote');
  assert.equal((await read(h.poll('main'), dot)).votes[dot], 1);
  const other = await fixture();
  await denied(await commit(other.member, [h.vote(other.member, 0)]), 'different room member denied');
});

test('managed trip polls allow enrolled members/admins and become read-only after completion', async () => {
  const h = await fixture('trip');
  await allowed(await commit(h.member, [write(h.poll('main'), h.payload(), ['createdAt'])]), 'trip member creates');
  await allowed(await commit(h.member, [h.vote(h.member, 1)]), 'trip member votes');
  await allowed(await commit(h.admin, [write(h.poll('main'), { closed: true }, ['closedAt'], ['closed'])]), 'trip admin closes');
  await allowed(await commit(h.member, [write(h.poll('open'), h.payload(), ['createdAt'])]), 'another open poll');
  await allowed(await commit('emulator-admin', [write(h.base, { status: 'completed' }, [], ['status'])]), 'complete fixture');
  await denied(await commit(h.member, [write(h.poll('new'), h.payload(), ['createdAt'])]), 'completed create');
  await denied(await commit(h.member, [h.vote(h.member, 0, 'open')]), 'completed vote');
  await denied(await commit(h.owner, [write(h.poll('open'), { closed: true }, ['closedAt'], ['closed'])]), 'completed closure');
  await allowed(await get(h.poll('open'), h.member), 'completed poll readable');
});

test('departure requirements are manager-only, reference existing items and cannot be overwritten', async () => {
  const h = await fixture();
  const data = uid => ({ itemId: 'passport', createdBy: uid });
  await denied(await commit(h.member, [write(h.requirement('passport'), data(h.member), ['createdAt'])]), 'ordinary member cannot choose requirements');
  await allowed(await commit(h.admin, [write(h.requirement('passport'), data(h.admin), ['createdAt'])]), 'packing admin marks requirement');
  await denied(await commit(h.owner, [write(h.requirement('passport'), data(h.owner), ['createdAt'])]), 'requirement immutable');
  await denied(await commit(h.owner, [write(h.requirement('missing'), { itemId: 'missing', createdBy: h.owner }, ['createdAt'])]), 'missing item denied');
  await denied(await commit(h.member, [{ delete: name(h.requirement('passport')) }]), 'member cannot unmark');
  await allowed(await get(h.requirement('passport'), h.member), 'participant reads');
  await denied(await get(h.requirement('passport'), 'outsider'), 'outsider read denied');
  await allowed(await commit(h.owner, [{ delete: name(h.requirement('passport')) }]), 'owner unmarks');
  await allowed(await commit(h.owner, [write(h.requirement('passport'), data(h.owner), ['createdAt'])]), 'owner re-marks with fresh time');
});

test('departure confirmations can be created, refreshed and undone only for oneself', async () => {
  const h = await fixture();
  await allowed(await commit(h.member, [write(h.confirmation(h.member), h.acknowledgement(), ['confirmedAt'])]), 'self confirms');
  await allowed(await get(h.confirmation(h.member), h.owner), 'group sees declaration');
  await allowed(await commit(h.member, [write(h.confirmation(h.member), { ...h.acknowledgement(), contextHash: 'b'.repeat(64) }, ['confirmedAt'])]), 'self refreshes');
  await denied(await commit(h.owner, [write(h.confirmation(h.member), h.acknowledgement(), ['confirmedAt'])]), 'organizer cannot impersonate member');
  await denied(await commit(h.owner, [{ delete: name(h.confirmation(h.member)) }]), 'organizer cannot undo another member');
  await allowed(await commit(h.member, [{ delete: name(h.confirmation(h.member)) }]), 'self undoes');
});

test('confirmation schema requires an active account-linked member and valid context/time', async () => {
  const h = await fixture();
  const invalid = [{ memberId: 'unlinked' }, { memberId: 'inactive' }, { memberId: h.owner }, { memberId: 'missing' },
    { uid: h.owner }, { contextHash: 'A'.repeat(64) }, { contextHash: 'a'.repeat(63) }, { contextHash: 10 }, { packed: true }, { memberId: '../foreign' }];
  for (const [index, patch] of invalid.entries()) await denied(await commit(h.member, [write(h.confirmation(h.member), { ...h.acknowledgement(), ...patch }, ['confirmedAt'])]), `invalid self confirmation ${index}`);
  await denied(await commit(h.member, [write(h.confirmation(h.member), { ...h.acknowledgement(), confirmedAt: new Date() })]), 'server time only');
  await denied(await commit('outsider', [write(h.confirmation('outsider'), h.acknowledgement('outsider'), ['confirmedAt'])]), 'nonparticipant denied');
  await denied(await get(h.confirmation(h.member), 'outsider'), 'nonparticipant cannot inspect confirmations');
});

test('managed departure checks remain readable but no longer writable after completion', async () => {
  const h = await fixture('trip');
  await allowed(await commit(h.owner, [write(h.requirement('passport'), { itemId: 'passport', createdBy: h.owner }, ['createdAt'])]), 'owner sets requirement');
  await allowed(await commit(h.member, [write(h.confirmation(h.member), h.acknowledgement(), ['confirmedAt'])]), 'member declares');
  await allowed(await commit('emulator-admin', [write(h.base, { status: 'completed' }, [], ['status'])]), 'complete');
  await denied(await commit(h.owner, [{ delete: name(h.requirement('passport')) }]), 'completed unmark');
  await denied(await commit(h.admin, [write(h.requirement('missing'), { itemId: 'missing', createdBy: h.admin }, ['createdAt'])]), 'completed requirement create');
  await denied(await commit(h.member, [write(h.confirmation(h.member), h.acknowledgement(), ['confirmedAt'])]), 'completed confirm');
  await denied(await commit(h.member, [{ delete: name(h.confirmation(h.member)) }]), 'completed undo');
  await allowed(await get(h.confirmation(h.member), h.owner), 'completed declaration readable');
});
