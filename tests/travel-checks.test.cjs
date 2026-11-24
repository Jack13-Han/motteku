const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, '..', file);
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name));
  return exports;
}
const checks = load('lib/travelChecks.ts');
const { createPackingItem } = load('lib/packing.ts');
const { translate } = load('lib/messages.ts');
const members = ['Hnin', 'Phyu', 'Kyaw', 'Aung', 'Yuki'].map((name, i) => ({ id: `m${i}`, uid: `user${i}`, name }));
const bags = [{ id: 'blue', name: 'Blue bag' }];
const dates = { startDate: '2026-11-13', endDate: '2026-11-15' };
const stays = [
  { id: 'hotel-a', name: 'Hotel A', checkInDate: '2026-11-13', checkOutDate: '2026-11-14', checkOutTime: '10:00', notificationMinutesBefore: 60 },
  { id: 'hotel-b', name: 'Hotel B', checkInDate: '2026-11-14', checkOutDate: '2026-11-15', checkOutTime: '10:00', notificationMinutesBefore: 30 },
];
const plan = { ...checks.initialTravelPlan(dates), accommodationMode: 'multiple', stays };
function packing() {
  const roster = members.map(member => ({ ...member })), storage = bags.map(bag => ({ ...bag }));
  const personal = createPackingItem('trip', 'owner', { name: 'Hiking shoes', type: 'personal', targetMemberIds: roster.map(m => m.id), units: [], status: 'packed', bagId: 'blue' }, roster, storage, 'shoes');
  const shared = createPackingItem('trip', 'owner', { name: 'Tent', type: 'shared', targetMemberIds: [], units: [{ memberId: 'm0', status: 'packed', bagId: 'blue' }], status: 'not_ready', bagId: '' }, roster, storage, 'tent');
  return { ownerUid: 'owner', adminUids: ['admin'], members: roster, bags: storage, items: [personal.item, shared.item], assignments: [...personal.assignments, ...shared.assignments] };
}

test('old trips normalize without mutations and all single/day trips have a mandatory return check', () => {
  const original = { ...dates, unrelated: 'kept' };
  assert.deepEqual(checks.normalizeTravelSettings(original), { accommodationMode: 'single', stays: [] });
  for (const mode of ['single', 'dayTrip']) {
    const definitions = checks.checkpointDefinitions('trip', { ...checks.initialTravelPlan(original), accommodationMode: mode });
    assert.equal(definitions.length, 1); assert.equal(definitions[0].type, 'returnHome'); assert.equal(definitions[0].id, 'return-home');
  }
  assert.deepEqual(original, { ...dates, unrelated: 'kept' });
});

test('two hotels yield exactly one moving check and one final return-home check', () => {
  assert.equal(checks.validateTravelPlan(plan, dates.startDate, dates.endDate), '');
  const definitions = checks.checkpointDefinitions('trip', plan);
  assert.deepEqual(definitions.map(check => [check.type, check.fromLocation, check.toLocation]), [['transition', 'Hotel A', 'Hotel B'], ['returnHome', 'Hotel B', '']]);
  assert.equal(new Date(definitions[1].scheduledAt).getHours(), 10);
});

test('three hotels yield two transitions, and next check advances to the mandatory return', () => {
  const third = { ...stays[1], id: 'hotel-c', name: 'Hotel C', checkInDate: '2026-11-15', checkOutDate: '2026-11-16' };
  const definitions = checks.checkpointDefinitions('trip', { ...plan, stays: [...stays, third] });
  assert.equal(definitions.filter(c => c.type === 'transition').length, 2);
  assert.equal(checks.nextTravelCheck(definitions).id, 'move-hotel-a');
  definitions[0].status = 'completed';
  assert.equal(checks.nextTravelCheck(definitions).id, 'move-hotel-b');
  definitions[1].status = 'completed';
  assert.equal(checks.nextTravelCheck(definitions).id, 'return-home');
  definitions[2].status = 'completed';
  assert.equal(checks.nextTravelCheck(definitions), undefined);
});

test('stay validation rejects missing names/times, out-of-trip dates, overlaps, reversed order and fewer than two stays', () => {
  for (const invalid of [
    { ...plan, stays: stays.slice(0, 1) },
    { ...plan, stays: [{ ...stays[0], name: '' }, stays[1]] },
    { ...plan, stays: [{ ...stays[0], checkOutTime: '' }, stays[1]] },
    { ...plan, stays: [{ ...stays[0], checkOutTime: '25:00' }, stays[1]] },
    { ...plan, stays: [{ ...stays[0], checkOutDate: '2026-11-12' }, stays[1]] },
    { ...plan, stays: [stays[1], stays[0]] },
    { ...plan, stays: [stays[0], { ...stays[1], checkInDate: '2026-11-13' }] },
    { ...plan, stays: [stays[0], { ...stays[1], notificationMinutesBefore: -1 }] },
  ]) assert.notEqual(checks.validateTravelPlan(invalid, dates.startDate, dates.endDate), '');
  assert.notEqual(checks.validateTravelPlan({ ...checks.initialTravelPlan(dates), returnTime: '' }, dates.startDate, dates.endDate), '');
});

test('snapshots include only current departure-packed assignments, one row per person and shared unit', () => {
  const data = packing();
  data.assignments[4].status = 'ready';
  data.assignments.push({ ...data.assignments[0], id: 'removed-member-row', memberId: 'removed' });
  const items = checks.snapshotPackedAssignments(data);
  assert.equal(items.length, 5); assert.equal(items.filter(i => i.itemType === 'personal').length, 4);
  assert.equal(items.find(i => i.itemType === 'shared').assigneeName, 'Hnin');
  assert.ok(items.every(i => i.status === 'unchecked' && i.originalBagName === 'Blue bag'));
  assert.equal(new Set(items.map(i => i.id)).size, 5);
  const before = JSON.stringify(items);
  data.items.length = 0; data.assignments.length = 0; data.bags[0].name = 'Changed bag';
  assert.equal(JSON.stringify(items), before);
});

test('personal check states remain independent and never overwrite departure status', () => {
  const data = packing(); const before = JSON.stringify(data);
  const items = checks.snapshotPackedAssignments(data);
  items[0] = { ...items[0], status: 'packed', currentBagId: 'blue', currentBagName: 'Blue bag' };
  assert.equal(checks.checkProgress({ items }).completed, 1);
  assert.equal(items.filter(i => i.status === 'unchecked' && i.itemType === 'personal').length, 4);
  assert.equal(JSON.stringify(data), before);
});

test('used-up and leave-behind items count as complete; missing and unpacked-without-bag remain unresolved', () => {
  const items = checks.snapshotPackedAssignments(packing()).slice(0, 5);
  ['usedUp', 'leaveBehind', 'missing', 'packed', 'unchecked'].forEach((status, i) => { items[i].status = status; });
  const result = checks.checkProgress({ items });
  assert.equal(result.completed, 2); assert.equal(result.unresolved.length, 3); assert.equal(result.missing.length, 1); assert.equal(result.unchecked.length, 2);
  items[3].currentBagId = 'blue'; items[3].currentBagName = 'Blue bag';
  assert.equal(checks.checkProgress({ items }).completed, 3);
});

test('own active members can edit their checks, admins and owners can edit all, and outsiders cannot', () => {
  const data = packing(), item = checks.snapshotPackedAssignments(data)[0];
  assert.equal(checks.canEditCheckItem(data, 'user0', item), true);
  for (const uid of ['owner', 'admin']) assert.equal(checks.canEditCheckItem(data, uid, item), true);
  for (const uid of ['user1', '', 'outsider']) assert.equal(checks.canEditCheckItem(data, uid, item), false);
  data.members[0].active = false;
  assert.equal(checks.canEditCheckItem(data, 'user0', item), false);
});

test('editing/reordering/removing stays keeps active snapshots intact and archives unused schedules without deletion', () => {
  const definitions = checks.checkpointDefinitions('trip', plan);
  definitions[0] = { ...definitions[0], status: 'inProgress', snapshotAt: 'saved', items: checks.snapshotPackedAssignments(packing()) };
  const result = checks.reconcileCheckSchedules(definitions, checks.checkpointDefinitions('trip', checks.initialTravelPlan(dates)));
  assert.deepEqual(result[0], definitions[0]); assert.equal(result.length, 2);
  const untouched = checks.checkpointDefinitions('trip', plan);
  const removed = checks.reconcileCheckSchedules(untouched, checks.checkpointDefinitions('trip', checks.initialTravelPlan(dates)));
  assert.equal(removed[0].archived, true); assert.equal(removed[1].type, 'returnHome');
});

test('checkout offsets calculate exact reminder instants and stored data survives refresh/JSON round trips', () => {
  const check = checks.checkpointDefinitions('trip', plan)[0];
  assert.equal(new Date(check.scheduledAt) - new Date(checks.travelReminderAt(check)), 3600000);
  const active = { ...check, snapshotAt: 'saved', status: 'inProgress', items: checks.snapshotPackedAssignments(packing()) };
  const saved = checks.storeTravelCheck(active);
  assert.equal(saved.unresolvedCount, 6); assert.equal(saved.missingCount, 0);
  assert.deepEqual(checks.readTravelCheck(JSON.parse(JSON.stringify(saved))).items, active.items);
});

test('new labels localize in both languages, while user names and custom item/bag names remain unmodified', () => {
  const { travelCheckMessages } = load('lib/messages-travel-checks.ts');
  for (const [key, ja] of Object.entries(travelCheckMessages)) { assert.equal(translate('en', key), key); assert.equal(translate('ja', key), ja); }
  const data = packing(); data.items[0].name = 'My Shoes';
  const item = checks.snapshotPackedAssignments(data)[0];
  assert.equal(item.itemName, 'My Shoes'); assert.equal(item.assigneeName, 'Hnin'); assert.equal(item.originalBagName, 'Blue bag');
});
