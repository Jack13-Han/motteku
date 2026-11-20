// Real Firestore Rules tests. Only the local emulator accepts these mock tokens.
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
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: fields(value) } };
}
function decode(value) {
  if ('stringValue' in value) return value.stringValue;
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
async function commit(uid, writes) {
  return fetch(`${root}:commit`, { method: 'POST', headers: headers(uid), body: JSON.stringify({ writes }), signal: AbortSignal.timeout(15000) });
}
function write(location, data, timestamps = [], mask) {
  return { update: { name: name(location), fields: fields(data) },
    ...(mask ? { updateMask: { fieldPaths: mask } } : {}),
    ...(timestamps.length ? { updateTransforms: timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
  };
}
async function expectStatus(response, expected, label) {
  assert.equal(response.status, expected, `${label}: ${await response.text()}`);
}
const allowed = (response, label) => expectStatus(response, 200, label);
const denied = (response, label) => expectStatus(response, 403, label);
async function fixture() {
  const room = 'chat-' + randomUUID().replaceAll('-', '');
  const alice = 'alice-' + randomUUID().slice(0, 8), bob = 'bob-' + randomUUID().slice(0, 8);
  const prefix = `sharedTrips/${room}/messages`;
  const source = { senderUid: alice, senderName: 'Alice', text: 'Meet at eight 👌', createdAt: new Date('2026-11-10T00:00:00Z') };
  await allowed(await commit('emulator-admin', [
    write(`sharedTrips/${room}`, { ownerUid: alice, inviteCode: 'test-code' }),
    ...[alice, bob].map(uid => write(`sharedTrips/${room}/members/${uid}`, { uid, name: uid, inviteCode: 'test-code' })),
    write(`${prefix}/source`, source),
  ]), 'seed isolated chat fixture');
  const payload = (text = 'Hello') => ({ senderUid: alice, senderName: 'Alice', text });
  const reply = () => ({ messageId: 'source', senderUid: alice, senderName: source.senderName, text: source.text });
  const reaction = (uid, value, target = 'source') => write(`${prefix}/${target}`, { reactions: value === undefined ? {} : { [uid]: value } }, [], [`reactions.\`${uid}\``]);
  async function read(target = 'source', uid = alice) {
    const result = await fetch(`${root}/${prefix}/${target}`, { headers: headers(uid), signal: AbortSignal.timeout(15000) });
    assert.equal(result.status, 200, await result.clone().text());
    return Object.fromEntries(Object.entries((await result.json()).fields).map(([key, value]) => [key, decode(value)]));
  }
  return { room, alice, bob, prefix, source, payload, reply, reaction, read };
}

test('members create ordinary text and verified same-room replies, and read older messages', async () => {
  const h = await fixture();
  await allowed(await commit(h.alice, [write(`${h.prefix}/plain`, h.payload(), ['createdAt'])]), 'plain text');
  await allowed(await commit(h.bob, [write(`${h.prefix}/reply`, { ...h.payload('I will be there'), senderUid: h.bob, replyTo: h.reply() }, ['createdAt'])]), 'same-room reply');
  const saved = await h.read('reply', h.bob);
  assert.equal(saved.replyTo.messageId, 'source'); assert.equal(saved.replyTo.text, h.source.text);
  assert.equal((await h.read()).text, h.source.text);
});

test('reply quote must exactly match the persisted source and contain only its four fields', async () => {
  const h = await fixture();
  const invalid = [
    { ...h.reply(), text: 'Forged quote' }, { ...h.reply(), senderName: 'Forged author' },
    { ...h.reply(), senderUid: h.bob }, { ...h.reply(), messageId: 'missing' },
    { ...h.reply(), messageId: '../other-room/source' }, { ...h.reply(), extra: 'injected' },
    { messageId: 'source', text: h.source.text }, null, [], 'source',
  ];
  for (const [index, replyTo] of invalid.entries()) {
    await denied(await commit(h.alice, [write(`${h.prefix}/invalid-${index}`, { ...h.payload(), replyTo }, ['createdAt'])]), `invalid reply ${index}`);
  }
});

test('a message from a different room cannot be used as the reply source', async () => {
  const h = await fixture();
  await allowed(await commit('emulator-admin', [write(`sharedTrips/foreign-${h.room}/messages/foreign`, h.source)]), 'foreign source fixture');
  await denied(await commit(h.alice, [write(`${h.prefix}/cross-room`, { ...h.payload(), replyTo: { ...h.reply(), messageId: 'foreign' } }, ['createdAt'])]), 'cross-room quote');
});

test('new messages reject photos, empty text, forged identity and initially supplied reactions', async () => {
  const h = await fixture();
  const invalid = [
    { ...h.payload(), imagePath: `sharedTrips/${h.room}/chat/${h.alice}/photo.jpg` },
    { ...h.payload(), imageName: 'photo.jpg' }, { ...h.payload(), reactions: {} },
    { ...h.payload(), reactions: { [h.bob]: 'like' } }, { ...h.payload(), senderUid: h.bob },
    h.payload(''), h.payload('a'.repeat(2001)),
  ];
  for (const [index, payload] of invalid.entries()) await denied(await commit(h.alice, [write(`${h.prefix}/invalid-${index}`, payload, ['createdAt'])]), `invalid new message ${index}`);
  await denied(await commit(h.alice, [write(`${h.prefix}/bad-time`, { ...h.payload(), createdAt: new Date('2026-01-01T00:00:00Z') })]), 'client-created timestamp');
});

test('a member adds, changes among exactly five reactions and removes only their own reaction', async () => {
  const h = await fixture();
  for (const type of ['like', 'angry', 'ok', 'haha', 'sad']) {
    await allowed(await commit(h.alice, [h.reaction(h.alice, type)]), `own ${type}`);
    assert.equal((await h.read()).reactions[h.alice], type);
  }
  await allowed(await commit(h.alice, [h.reaction(h.alice, undefined)]), 'remove own reaction');
  assert.equal((await h.read()).reactions?.[h.alice], undefined);
  for (const invalid of ['heart', '👍', '', 12, { like: true }, ['like']]) await denied(await commit(h.alice, [h.reaction(h.alice, invalid)]), 'unsupported reaction');
});

test('reaction updates cannot replace, add or delete another member reaction', async () => {
  const h = await fixture();
  await allowed(await commit(h.bob, [h.reaction(h.bob, 'haha')]), 'bob reacts');
  await denied(await commit(h.alice, [h.reaction(h.bob, 'angry')]), 'change bob');
  await denied(await commit(h.alice, [h.reaction(h.bob, undefined)]), 'remove bob');
  await denied(await commit(h.alice, [write(`${h.prefix}/source`, { reactions: { [h.alice]: 'like' } }, [], ['reactions'])]), 'overwrite other reactions map');
  await denied(await commit(h.alice, [write(`${h.prefix}/source`, {}, [], ['reactions'])]), 'delete complete reactions map');
  await allowed(await commit(h.alice, [h.reaction(h.alice, 'like')]), 'add alice without replacing bob');
  assert.equal((await h.read()).reactions[h.bob], 'haha');
});

test('reaction-only updates cannot edit text, author, reply, timestamp or delete a message', async () => {
  const h = await fixture();
  for (const patch of [{ text: 'Rewritten' }, { senderUid: h.bob }, { senderName: 'Bob' }, { replyTo: h.reply() }, { createdAt: new Date() }, { imagePath: 'injected' }]) {
    await denied(await commit(h.alice, [write(`${h.prefix}/source`, { ...patch, reactions: { [h.alice]: 'like' } }, [], [...Object.keys(patch), 'reactions'])]), 'immutable message content');
  }
  await denied(await commit(h.alice, [{ delete: name(`${h.prefix}/source`) }]), 'message deletion');
});

test('nonmembers and unsigned users cannot read, send, reply or react', async () => {
  const h = await fixture();
  for (const uid of ['outsider', null]) {
    const get = await fetch(`${root}/${h.prefix}/source`, { headers: headers(uid), signal: AbortSignal.timeout(15000) });
    await denied(get, 'outsider read');
    await denied(await commit(uid, [write(`${h.prefix}/outsider-${uid || 'guest'}`, { ...h.payload(), senderUid: uid || 'guest', replyTo: h.reply() }, ['createdAt'])]), 'outsider reply');
    await denied(await commit(uid, [h.reaction(uid || 'guest', 'like')]), 'outsider reaction');
  }
});

test('concurrent field-path updates retain both members reactions', async () => {
  const h = await fixture();
  const responses = await Promise.all([commit(h.alice, [h.reaction(h.alice, 'like')]), commit(h.bob, [h.reaction(h.bob, 'ok')])]);
  await Promise.all(responses.map((response, index) => allowed(response, `concurrent member ${index}`)));
  const saved = await h.read();
  assert.equal(saved.reactions[h.alice], 'like'); assert.equal(saved.reactions[h.bob], 'ok');
  await allowed(await commit(h.alice, [h.reaction(h.alice, undefined)]), 'remove one while retaining another');
  assert.equal((await h.read()).reactions[h.bob], 'ok');
});

test('older photo-only messages stay readable, can be replied to and receive reactions', async () => {
  const h = await fixture();
  await allowed(await commit('emulator-admin', [write(`${h.prefix}/old-photo`, { ...h.source, text: '', imagePath: 'legacy-photo.jpg', imageName: 'Holiday' })]), 'seed older photo');
  await allowed(await commit(h.alice, [h.reaction(h.alice, 'sad', 'old-photo')]), 'react to older photo');
  await allowed(await commit(h.alice, [write(`${h.prefix}/old-photo-reply`, { ...h.payload('I remember this'), replyTo: { ...h.reply(), messageId: 'old-photo', text: '' } }, ['createdAt'])]), 'reply to older photo');
  assert.equal((await h.read('old-photo')).imageName, 'Holiday');
});
