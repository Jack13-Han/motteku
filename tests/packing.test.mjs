import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPackingItem, packingProgress, canEditAssignment, restorePackingData } from '../lib/packing.ts';

const members = ['Aung', 'Mya', 'Yuki', 'Ken', 'Su'].map((name, i) => ({ id: `m${i}`, name, uid: `user${i}` }));
const bags = [{ id: 'black', name: 'Aungの黒いバッグ' }, { id: 'blue', name: 'Yukiの青いバッグ' }];
const input = { name: 'ハイキングシューズ', type: 'personal', targetMemberIds: members.map(m => m.id), units: [], status: 'not_ready', bagId: '' };

test('5人に別々の準備状況を作成し、1人の更新は他の4人に影響しない', () => {
  const { item, assignments } = createPackingItem('trip', 'owner', input, members, bags, 'shoes');
  assert.equal(assignments.length, 5);
  let rows = assignments.map((a, i) => i === 0 ? { ...a, status: 'packed', bagId: 'black' } : a);
  assert.equal(packingProgress(item, rows).ready, 1);
  assert.equal(rows.filter(a => a.status === 'not_ready').length, 4);
  assert.equal(packingProgress(item, rows).allPacked, false);
  rows = rows.map((a, i) => i === 1 ? { ...a, status: 'ready' } : a);
  assert.equal(packingProgress(item, rows).ready, 2);
  assert.deepEqual(packingProgress(item, rows).notReadyMemberIds, ['m2', 'm3', 'm4']);
  const ready = rows.map(a => ({ ...a, status: 'ready' }));
  assert.equal(packingProgress(item, ready).ready, 5);
  assert.equal(packingProgress(item, ready).allPacked, false);
  assert.equal(packingProgress(item, rows.map(a => ({ ...a, status: 'packed' }))).allPacked, true);
  assert.equal(packingProgress(item, rows.slice(0, 1)).allPacked, false);
});

test('対象者の一部選択と重複除去', () => {
  const result = createPackingItem('trip', 'owner', { ...input, targetMemberIds: ['m0', 'm2', 'm0'] }, members, bags, 'medicine');
  assert.deepEqual(result.item.targetMemberIds, ['m0', 'm2']);
  assert.equal(result.assignments.length, 2);
});

test('Packed2人と準備済み1人を3/5人として数え、全員完了にはしない', () => {
  const { item, assignments } = createPackingItem('trip', 'owner', input, members, bags, 'shoes');
  const rows = assignments.map((a, i) => ({ ...a, status: ['packed', 'packed', 'ready', 'not_ready', 'not_ready'][i] }));
  const progress = packingProgress(item, rows);
  assert.equal(progress.ready, 3);
  assert.equal(progress.packed, 2);
  assert.equal(progress.allPacked, false);
  assert.deepEqual(progress.notReadyMemberIds, ['m3', 'm4']);
  for (const patch of [{ name: 'x'.repeat(201) }, { type: 'invalid' }]) {
    assert.throws(() => createPackingItem('trip', 'owner', { ...input, ...patch }, members, bags, 'invalid'));
  }
});

test('Packedが3/5なら未完了の2人を示し、5/5で全員準備完了になる', () => {
  const { item, assignments } = createPackingItem('trip', 'owner', input, members, bags, 'shoes');
  const rows = assignments.map((a, i) => ({ ...a, status: i < 3 ? 'packed' : 'ready' }));
  const partial = packingProgress(item, rows);
  assert.equal(partial.packed, 3);
  assert.equal(partial.total, 5);
  assert.equal(partial.allPacked, false);
  assert.deepEqual(partial.notPackedMemberIds, ['m3', 'm4']);
  assert.deepEqual(packingProgress(item, rows.slice(0, 3)).notPackedMemberIds, ['m3', 'm4']);
  const complete = packingProgress(item, rows.map(a => ({ ...a, status: 'packed' })));
  assert.equal(complete.packed, 5);
  assert.equal(complete.allPacked, true);
  assert.deepEqual(complete.notPackedMemberIds, []);
});

test('共有用は1個ずつ担当者・状態・バッグを保持する', () => {
  const result = createPackingItem('trip', 'owner', { ...input, name: 'テント', type: 'shared', units: [{ memberId: 'm0', status: 'packed', bagId: 'black' }, { memberId: 'm2', status: 'not_ready', bagId: 'blue' }] }, members, bags, 'tent');
  assert.equal(result.item.quantity, 2);
  assert.deepEqual(result.item.targetMemberIds, []);
  assert.deepEqual(result.assignments.map(a => [a.unitNumber, a.memberId, a.status, a.bagId]), [[1, 'm0', 'packed', 'black'], [2, 'm2', 'not_ready', 'blue']]);
  assert.equal(packingProgress(result.item, result.assignments).allPacked, false);
});

test('本人・作成者・管理者だけ編集できる', () => {
  const { assignments } = createPackingItem('trip', 'owner', input, members, bags, 'shoes');
  const data = { ownerUid: 'owner', adminUids: ['admin'], members };
  assert.equal(canEditAssignment(data, 'user0', assignments[0]), true);
  assert.equal(canEditAssignment(data, 'user1', assignments[0]), false);
  assert.equal(canEditAssignment(data, 'owner', assignments[0]), true);
  assert.equal(canEditAssignment(data, 'admin', assignments[0]), true);
  assert.equal(canEditAssignment(data, '', assignments[0]), false);
});

test('無効な対象者・担当者・バッグと空の対象を拒否する', () => {
  for (const patch of [{ targetMemberIds: [] }, { targetMemberIds: ['unknown'] }, { bagId: 'other-trip' }, { status: 'invalid' }, { name: '  ' }, { type: 'shared', units: [{ memberId: '', status: 'not_ready', bagId: '' }] }]) {
    assert.throws(() => createPackingItem('trip', 'owner', { ...input, ...patch }, members, bags, 'invalid'));
  }
});

test('ローカル保存を復元しても時刻・本人別状態・バッグが残る', () => {
  const result = createPackingItem('trip', 'owner', input, members, bags, 'shoes');
  const original = { ownerUid: 'owner', adminUids: [], members, bags, items: [result.item], assignments: result.assignments.map((a, i) => i === 0 ? { ...a, status: 'packed', bagId: 'black' } : a) };
  const restored = restorePackingData(JSON.parse(JSON.stringify(original)));
  assert.equal(packingProgress(restored.items[0], restored.assignments).ready, 1);
  assert.equal(restored.assignments[0].bagId, 'black');
  assert.ok(restored.items[0].createdAt.toDate() instanceof Date);
});
