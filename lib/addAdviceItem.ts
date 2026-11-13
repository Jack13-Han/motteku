import { doc, serverTimestamp } from 'firebase/firestore';
import { createPackingItem } from './packing';
import type { usePacking } from './usePacking';

export async function addAdviceItem(packing: ReturnType<typeof usePacking>, scope: string, uid: string, name: string, type: 'personal' | 'shared'): Promise<boolean> {
  const data = packing.data;
  if (!data || !packing.loaded || packing.busy || !uid || (data.ownerUid !== uid && !data.adminUids.includes(uid))) throw new Error('Only the organizer or an admin can add suggested items.');
  if (data.items.some(item => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) return true;
  const members = data.members.filter(member => member.active !== false);
  const assignee = members.find(member => member.uid === uid) || members[0];
  const result = createPackingItem(scope, uid, { name, type, targetMemberIds: members.map(member => member.id), units: [{ memberId: assignee?.id || '', status: 'not_ready', bagId: '' }], status: 'not_ready', bagId: '' }, members, data.bags, crypto.randomUUID());
  return packing.mutate(current => ({ ...current, items: [...current.items, result.item], assignments: [...current.assignments, ...result.assignments] }), (batch, parent) => {
    batch.set(doc(parent, 'items', result.item.id), { ...result.item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    result.assignments.forEach(assignment => batch.set(doc(parent, 'itemAssignments', assignment.id), { ...assignment, updatedAt: serverTimestamp() }));
  });
}
