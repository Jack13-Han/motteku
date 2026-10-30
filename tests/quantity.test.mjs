import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditAssignment, isCurrentAssignment, packingItemName, packingProgress, reconcilePacking, requiredQuantity, restorePackingData } from '../lib/packing.ts';
import { packingTemplates } from '../lib/packingTemplates.ts';

const members = ['Aung', 'Mya', 'Yuki', 'Ken', 'Su'].map((name, i) => ({ id: `m${i}`, name, uid: `u${i}` }));
const initial = () => ({ ownerUid: 'owner', adminUids: [], members, bags: [{ id: 'black', name: '黒いバッグ' }], items: [], assignments: [] });
const camping = packingTemplates.Camping.map(template => ({ template }));
const towel = packingTemplates.Beach.find(t => t.id === 'towel');

test('per-person, fixed and capacity calculate actual quantities for five members', () => {
  assert.equal(requiredQuantity(packingTemplates.Hiking.find(t => t.id === 'hiking-shoes'), 5), 5);
  assert.equal(requiredQuantity(towel, 5), 10);
  assert.equal(requiredQuantity(packingTemplates.Camping.find(t => t.id === 'tent'), 5), 2);
  assert.equal(requiredQuantity(packingTemplates.Camping.find(t => t.id === 'cooking-set'), 5), 2);
  assert.equal(requiredQuantity(packingTemplates.Camping.find(t => t.id === 'first-aid'), 5), 1);
  for (const template of packingTemplates.Camping) assert.ok(Number.isSafeInteger(requiredQuantity(template, 5)));
});

test('two towels each creates five independent member checklists, not one quantity checkbox', () => {
  const generated = reconcilePacking(initial(), members, 'trip', 'owner', [{ template: towel }]);
  assert.equal(generated.items[0].quantity, 10);
  assert.equal(generated.assignments.length, 5);
  generated.assignments[0] = { ...generated.assignments[0], status: 'packed', bagId: 'black' };
  assert.equal(packingProgress(generated.items[0], generated.assignments).ready, 1);
  assert.equal(generated.assignments.filter(a => a.status === 'not_ready').length, 4);
});

test('adding members creates only missing rows and preserves every existing status, bag and assignee', () => {
  const generated = reconcilePacking(initial(), members, 'trip', 'owner', camping);
  generated.assignments = generated.assignments.map((a, i) => ({ ...a, status: i % 2 ? 'ready' : 'packed', bagId: 'black', ...(a.unitNumber ? { memberId: 'm0' } : {}) }));
  const before = JSON.stringify(generated);
  const next = reconcilePacking(generated, [...members, { id: 'm5', name: 'New member' }, { id: 'm6', name: 'Another member' }], 'trip', 'owner');
  assert.equal(next.items.find(i => i.id === 'template-tent').quantity, 3);
  for (const assignment of generated.assignments) assert.strictEqual(next.assignments.find(a => a.id === assignment.id), assignment);
  assert.equal(next.assignments.find(a => a.id === 'template-tent_unit_3').status, 'not_ready');
  assert.equal(next.assignments.find(a => a.id === 'template-tent_unit_3').memberId, '');
  assert.equal(JSON.stringify(generated), before);
  const again = reconcilePacking(next, next.members.filter(m => m.active !== false), 'trip', 'owner', camping);
  assert.equal(again.assignments.length, next.assignments.length);
  assert.deepEqual(again.items, next.items);
});

test('shrinking a group retains checks and surplus shared units; growing again restores them', () => {
  const generated = reconcilePacking(initial(), members, 'trip', 'owner', camping);
  generated.assignments = generated.assignments.map(a => ({ ...a, status: 'packed', bagId: 'black', ...(a.unitNumber ? { memberId: 'm4' } : {}) }));
  const reduced = reconcilePacking(generated, members.slice(0, 3), 'trip', 'owner');
  assert.equal(reduced.items.find(i => i.id === 'template-tent').quantity, 1);
  assert.equal(reduced.assignments.length, generated.assignments.length);
  assert.equal(reduced.members.find(m => m.id === 'm4').active, false);
  assert.equal(canEditAssignment(reduced, 'u4', reduced.assignments.find(a => a.memberId === 'm4')), false);
  const extra = reduced.assignments.find(a => a.id === 'template-tent_unit_2');
  assert.equal(isCurrentAssignment(reduced.items.find(i => i.id === 'template-tent'), extra), false);
  assert.equal(extra.memberId, 'm4');
  assert.equal(extra.status, 'packed');
  const restored = reconcilePacking(reduced, members, 'trip', 'owner');
  assert.strictEqual(restored.assignments.find(a => a.id === extra.id), extra);
  assert.equal(isCurrentAssignment(restored.items.find(i => i.id === 'template-tent'), extra), true);
  assert.equal(restored.members.find(m => m.id === 'm4').active, true);
});

test('templates and archived rows survive serialization and names do not translate user overrides', () => {
  const generated = reconcilePacking(initial(), members, 'trip', 'owner', [{ template: towel }, { template: packingTemplates.Camping[0], customName: 'Tent' }]);
  const restored = restorePackingData(JSON.parse(JSON.stringify(generated)));
  assert.equal(restored.items[0].template.quantityPerPerson, 2);
  assert.equal(packingItemName(restored.items[0], () => 'タオル'), 'タオル');
  assert.equal(packingItemName(restored.items[1], () => 'テント'), 'Tent');
  assert.equal(restored.assignments[0].updatedAt.toDate() instanceof Date, true);
});

test('invalid and empty member counts or malformed rules are rejected before saving', () => {
  assert.throws(() => reconcilePacking(initial(), [], 'trip', 'owner'));
  assert.throws(() => reconcilePacking(initial(), [members[0], members[0]], 'trip', 'owner'));
  for (const count of [-1, 1.5, 101]) assert.throws(() => requiredQuantity(towel, count));
  assert.throws(() => requiredQuantity({ ...towel, quantityPerPerson: 0 }, 5));
  assert.throws(() => requiredQuantity({ ...towel, quantityRule: 'fixed', fixedQuantity: 2 }, 5));
});
