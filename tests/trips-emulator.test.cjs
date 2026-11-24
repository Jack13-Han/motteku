const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const sdk = require('firebase/firestore');
sdk.setLogLevel('silent');
const root = path.resolve(__dirname, '..');
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Run only through the local Firestore emulator');
const projectId = 'demo-motteku';
const clients = [];
function client(label, options = {}) {
  const uid = label + '-' + randomUUID().slice(0, 8);
  const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: 'emulator-only' }, uid);
  const db = sdk.getFirestore(app);
  const [address, port] = host.split(':');
  sdk.connectFirestoreEmulator(db, address, Number(port), { mockUserToken: { sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} } } });
  const serviceSdk = options.forgeForeignFriendName ? { ...sdk, runTransaction: (database, action, settings) => sdk.runTransaction(database, transaction => action({
    get: ref => transaction.get(ref),
    set: (ref, value) => transaction.set(ref, ref.path.startsWith('users/') && ref.path.includes('/friends/') && !ref.path.startsWith(`users/${uid}/`) ? { ...value, name: 'Forged friend name' } : value),
    update: (ref, value) => transaction.update(ref, value),
  }), settings) } : sdk;
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib', relative + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', source)(exports, name => name === './firebase' ? { db } : name === 'firebase/firestore' ? serviceSdk : name.startsWith('./') ? load(name.slice(2)) : require(name));
    cache.set(relative, exports); return exports;
  }
  const user = { uid, displayName: label, email: `${uid}@example.test`, isAnonymous: false };
  const result = { uid, app, db, user, service: load('tripService'), packing: load('packing'), templates: load('packingTemplates').packingTemplates };
  clients.push(result); return result;
}
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied');

test('draft, concurrent invite joins, confirmation, packing, roles and invitation lifecycle', async () => {
  const owner = client('Owner'), a = client('Aung'), b = client('Mya'), late = client('Yuki'), outsider = client('Outsider');
  try {
    const tripId = await owner.service.createDraftTrip({ name: 'Motteku integration', type: 'camping', mode: 'group', destination: '', startDate: '', endDate: '', description: '', plannedMemberCount: 5 }, owner.user);
    const tripRef = sdk.doc(owner.db, 'trips', tripId);
    console.log('Draft created with owner and packing parent.');
    assert.equal((await sdk.getDoc(tripRef)).data().status, 'draft');
    assert.equal((await sdk.getDoc(sdk.doc(owner.db, 'trips', tripId, 'tripMembers', owner.uid))).data().role, 'owner');
    assert.equal((await sdk.getDoc(tripRef)).data().joinedMemberCount, 1);
    assert.equal((await sdk.getDoc(tripRef)).data().tripDetailsReady, false);
    await assert.rejects(owner.service.updateTripDetails(tripId, { type: 'camping', destination: 'Osaka', startDate: '2026-11-01', endDate: '2026-11-03', description: 'User text' }), /friend must accept/);
    await denied(sdk.getDoc(sdk.doc(outsider.db, 'trips', tripId)));
    await denied(sdk.updateDoc(tripRef, { joinedMemberCount: 9, updatedAt: sdk.serverTimestamp() }));
    const inviteId = await owner.service.issueInvitation(tripId, owner.user);
    console.log('Invitation created.');
    assert.equal((await sdk.getDoc(tripRef)).data().status, 'recruiting');
    const preview = await a.service.readInvitation(inviteId);
    assert.equal(preview.preview.name, 'Motteku integration');
    assert.equal(preview.preview.joinedMemberCount, 1);
    assert.equal(preview.preview.tripDetailsReady, false);
    assert.ok(preview.expiresAt.toMillis() > Date.now() + 6 * 86400000);
    await Promise.all([a.service.joinTrip(inviteId, a.user), b.service.joinTrip(inviteId, b.user)]);
    console.log('Concurrent participants joined.');
    await denied(sdk.updateDoc(sdk.doc(a.db, 'users', owner.uid, 'friends', a.uid), { name: 'Changed after joining', createdAt: sdk.serverTimestamp() }));
    await denied(sdk.updateDoc(sdk.doc(a.db, 'users', owner.uid, 'friends', a.uid), { name: 'Aung', createdAt: sdk.serverTimestamp() }));
    assert.equal((await sdk.getDoc(tripRef)).data().joinedMemberCount, 3);
    assert.equal((await sdk.getDocs(sdk.collection(owner.db, 'trips', tripId, 'tripMembers'))).size, 3);
    const ownerFriend = (await sdk.getDoc(sdk.doc(owner.db, 'users', owner.uid, 'friends', a.uid))).data();
    const acceptedFriend = (await sdk.getDoc(sdk.doc(a.db, 'users', a.uid, 'friends', owner.uid))).data();
    assert.equal(ownerFriend.name, 'Aung'); assert.equal(acceptedFriend.name, 'Owner');
    const forger = client('Forger', { forgeForeignFriendName: true });
    await denied(forger.service.joinTrip(inviteId, forger.user));
    assert.equal((await sdk.getDoc(sdk.doc(forger.db, 'trips', tripId, 'tripMembers', forger.uid))).exists(), false, 'A rejected reciprocal friend write must not partially accept the invitation');
    assert.equal((await sdk.getDoc(tripRef)).data().joinedMemberCount, 3);
    await denied(sdk.getDoc(sdk.doc(outsider.db, 'users', owner.uid, 'friends', a.uid)));
    await assert.rejects(owner.service.confirmMembers(tripId, [owner.uid, a.uid, b.uid], true), /destination and dates/);
    await owner.service.updateTripDetails(tripId, { type: 'camping', destination: 'Osaka', startDate: '2026-11-01', endDate: '2026-11-03', description: 'User text' });
    assert.equal((await sdk.getDoc(tripRef)).data().tripDetailsReady, true);
    const updatedPreview = (await a.service.readInvitation(inviteId)).preview;
    assert.equal(updatedPreview.destination, 'Osaka'); assert.equal(updatedPreview.tripDetailsReady, true);
    assert.equal('description' in updatedPreview, false); assert.equal('type' in updatedPreview, false);
    await assert.rejects(a.service.joinTrip(inviteId, a.user), /already joined/);
    await denied(a.service.issueInvitation(tripId, a.user));
    await denied(a.service.setMemberRole(tripId, a.uid, 'admin'));
    await owner.service.setMemberRole(tripId, a.uid, 'admin');
    assert.equal((await sdk.getDoc(sdk.doc(a.db, 'trips', tripId, 'tripMembers', a.uid))).data().role, 'admin');
    await denied(a.service.confirmMembers(tripId, [owner.uid, a.uid, b.uid], true));
    await owner.service.confirmMembers(tripId, [owner.uid, a.uid, b.uid], true);
    const sourceMembers = (await sdk.getDocs(sdk.collection(owner.db, 'trips', tripId, 'tripMembers'))).docs.map(d => d.data());
    const packing = { ownerUid: owner.uid, adminUids: [], members: [{ id: owner.uid, uid: owner.uid, name: 'Owner', active: true }], bags: [], items: [], assignments: [] };
    const selections = owner.templates.Camping.filter(t => ['water-bottle', 'tent', 'first-aid'].includes(t.id)).map(template => ({ template }));
    let plan = owner.packing.reconcilePacking(packing, sourceMembers, tripId, owner.uid, selections.filter(selection => selection.template.type === 'personal'));
    async function persistPlan(next, previous) {
      for (const m of next.members) await sdk.setDoc(sdk.doc(owner.db, 'packingTrips', tripId, 'members', m.id), m);
      for (const item of next.items) {
        const ref = sdk.doc(owner.db, 'packingTrips', tripId, 'items', item.id);
        if (previous.items.some(i => i.id === item.id)) await sdk.updateDoc(ref, { quantity: item.quantity, targetMemberIds: item.targetMemberIds, updatedAt: sdk.serverTimestamp() });
        else await sdk.setDoc(ref, { ...item, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() });
      }
      for (const row of next.assignments.filter(a => !previous.assignments.some(old => old.id === a.id))) await sdk.setDoc(sdk.doc(owner.db, 'packingTrips', tripId, 'itemAssignments', row.id), { ...row, updatedAt: sdk.serverTimestamp() });
    }
    await persistPlan(plan, packing);
    await owner.service.markPackingReady(tripId, [owner.uid, a.uid, b.uid]);
    const sharedPlan = owner.packing.reconcilePacking(plan, sourceMembers, tripId, owner.uid, selections);
    const sharedItem = sharedPlan.items.find(item => item.type === 'shared');
    await denied(sdk.setDoc(sdk.doc(owner.db, 'packingTrips', tripId, 'items', sharedItem.id), { ...sharedItem, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
    await owner.service.openSharedPacking(tripId);
    assert.equal((await sdk.getDoc(tripRef)).data().packingReady, false, 'Interrupted shared generation must remain resumable');
    assert.equal((await sdk.getDoc(tripRef)).data().packingPhase, 'shared');
    await persistPlan(sharedPlan, plan);
    plan = sharedPlan;
    await owner.service.markPackingReady(tripId, [owner.uid, a.uid, b.uid]);
    const packingRef = sdk.doc(a.db, 'packingTrips', tripId);
    await sdk.updateDoc(packingRef, { bags: [{ id: 'black', name: 'Aungの黒いバッグ' }], bagIds: ['black'] });
    await denied(sdk.updateDoc(sdk.doc(b.db, 'packingTrips', tripId), { bags: [], bagIds: [] }));
    const tentRow = sdk.doc(owner.db, 'packingTrips', tripId, 'itemAssignments', 'template-tent_unit_1');
    await sdk.updateDoc(tentRow, { memberId: b.uid, updatedAt: sdk.serverTimestamp() });
    await sdk.updateDoc(sdk.doc(b.db, 'packingTrips', tripId, 'itemAssignments', 'template-tent_unit_1'), { status: 'packed', bagId: 'black', updatedAt: sdk.serverTimestamp() });
    await denied(sdk.updateDoc(sdk.doc(b.db, 'packingTrips', tripId, 'itemAssignments', 'template-tent_unit_1'), { memberId: owner.uid, updatedAt: sdk.serverTimestamp() }));
    await denied(sdk.updateDoc(tentRow, { memberId: outsider.uid, updatedAt: sdk.serverTimestamp() }));
    const ownRow = sdk.doc(b.db, 'packingTrips', tripId, 'itemAssignments', `template-water-bottle_${b.uid}`);
    await sdk.updateDoc(ownRow, { status: 'packed', bagId: 'black', updatedAt: sdk.serverTimestamp() });
    await denied(sdk.updateDoc(sdk.doc(b.db, 'packingTrips', tripId, 'itemAssignments', `template-water-bottle_${owner.uid}`), { status: 'packed', updatedAt: sdk.serverTimestamp() }));
    const before = (await sdk.getDoc(ownRow)).data();
    await late.service.joinTrip(inviteId, late.user);
    assert.equal((await sdk.getDoc(tripRef)).data().joinedMemberCount, 4);
    const waterRef = sdk.doc(owner.db, 'packingTrips', tripId, 'items', 'template-water-bottle');
    assert.equal((await sdk.getDoc(waterRef)).data().quantity, 3, 'joining must not change the checklist');
    await denied(sdk.updateDoc(waterRef, { quantity: 4, targetMemberIds: [...plan.items.find(i => i.id === 'template-water-bottle').targetMemberIds, late.uid], updatedAt: sdk.serverTimestamp() }));
    const allMembers = [...sourceMembers, { id: late.uid, uid: late.uid, name: 'Yuki' }];
    const ids = allMembers.map(m => m.uid);
    await owner.service.confirmMembers(tripId, ids, false);
    const updated = owner.packing.reconcilePacking(plan, allMembers, tripId, owner.uid);
    await persistPlan(updated, plan);
    await owner.service.markPackingReady(tripId, ids);
    assert.equal((await sdk.getDoc(waterRef)).data().quantity, 4);
    assert.equal((await sdk.getDoc(sdk.doc(owner.db, 'packingTrips', tripId, 'items', 'template-tent'))).data().quantity, 2);
    assert.equal((await sdk.getDoc(ownRow)).data().status, 'packed');
    assert.equal((await sdk.getDoc(ownRow)).data().updatedAt.toMillis(), before.updatedAt.toMillis());
    assert.equal((await sdk.getDoc(ownRow)).data().bagId, 'black');
    const retainedTent = (await sdk.getDoc(tentRow)).data();
    assert.equal(retainedTent.memberId, b.uid); assert.equal(retainedTent.status, 'packed'); assert.equal(retainedTent.bagId, 'black');
    const newInvite = await a.service.issueInvitation(tripId, a.user);
    await denied(outsider.service.joinTrip(inviteId, outsider.user));
    await owner.service.disableInvitation(tripId);
    await denied(outsider.service.joinTrip(newInvite, outsider.user));
    async function seedInvite(id, field, value) {
      const url = `http://${host}/v1/projects/${projectId}/databases/(default)/documents/tripInvitations/${id}?updateMask.fieldPaths=${field}`;
      const response = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { [field]: value } }) });
      assert.equal(response.status, 200);
    }
    const expiredInvite = await owner.service.issueInvitation(tripId, owner.user);
    await seedInvite(expiredInvite, 'expiresAt', { timestampValue: new Date(Date.now() - 1000).toISOString() });
    await denied(outsider.service.joinTrip(expiredInvite, outsider.user));
    const finalInvite = await owner.service.issueInvitation(tripId, owner.user);
    await seedInvite(finalInvite, 'maxUses', { integerValue: '1' });
    const twice = await Promise.allSettled([outsider.service.joinTrip(finalInvite, outsider.user), outsider.service.joinTrip(finalInvite, outsider.user)]);
    assert.equal(twice.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await sdk.getDoc(tripRef)).data().joinedMemberCount, 5);
    const extra = client('Full-invitation');
    await denied(extra.service.joinTrip(finalInvite, extra.user));
    await denied(owner.service.createDraftTrip({ name: 'Anonymous', mode: 'single', type: 'camping', destination: 'Osaka', startDate: '2026-11-01', endDate: '2026-11-03', description: '', plannedMemberCount: 1 }, { ...owner.user, uid: extra.uid }));
    await owner.service.completeTrip(tripId);
    await denied(sdk.updateDoc(ownRow, { status: 'ready', updatedAt: sdk.serverTimestamp() }));
    await denied(sdk.getDoc(sdk.doc(client('Nonmember').db, 'trips', tripId)));
  } finally {
    await Promise.all(clients.splice(0).map(async c => { await sdk.terminate(c.db); await deleteApp(c.app); }));
  }
});

test('single trip starts personal packing without invitations, friends or a shared packing stage', async () => {
  const owner = client('Solo');
  try {
    const id = await owner.service.createDraftTrip({ name: 'Solo trip', mode: 'single', type: 'camping', destination: 'Kyoto', startDate: '2026-12-01', endDate: '2026-12-02', description: '', plannedMemberCount: 1 }, owner.user);
    const ref = sdk.doc(owner.db, 'trips', id);
    assert.equal((await sdk.getDoc(ref)).data().tripDetailsReady, true);
    await assert.rejects(owner.service.issueInvitation(id, owner.user), /Single trips/);
    await owner.service.confirmMembers(id, [owner.uid], true);
    const members = [{ id: owner.uid, uid: owner.uid, name: 'Solo', active: true }];
    const data = { ownerUid: owner.uid, adminUids: [], members, bags: [], items: [], assignments: [] };
    const plan = owner.packing.reconcilePacking(data, members, id, owner.uid, owner.templates.Camping.filter(template => template.id === 'water-bottle').map(template => ({ template })));
    const batch = sdk.writeBatch(owner.db);
    plan.items.forEach(item => batch.set(sdk.doc(owner.db, 'packingTrips', id, 'items', item.id), { ...item, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
    plan.assignments.forEach(row => batch.set(sdk.doc(owner.db, 'packingTrips', id, 'itemAssignments', row.id), { ...row, updatedAt: sdk.serverTimestamp() }));
    await batch.commit(); await owner.service.markPackingReady(id, [owner.uid]);
    await assert.rejects(owner.service.openSharedPacking(id), /personal packing/);
    const shared = owner.packing.createPackingItem(id, owner.uid, { name: 'Shared tent', type: 'shared', targetMemberIds: [], units: [{ memberId: owner.uid, status: 'not_ready', bagId: '' }], status: 'not_ready', bagId: '' }, members, [], 'forbidden-shared').item;
    await denied(sdk.setDoc(sdk.doc(owner.db, 'packingTrips', id, 'items', shared.id), { ...shared, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));
    assert.equal((await sdk.getDocs(sdk.collection(owner.db, 'users', owner.uid, 'friends'))).size, 0);
  } finally {
    await Promise.all(clients.splice(0).map(async c => { await sdk.terminate(c.db); await deleteApp(c.app); }));
  }
});
