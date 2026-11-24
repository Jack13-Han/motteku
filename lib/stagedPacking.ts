import { isCurrentAssignment, type PackingData } from './packing';

/** Check actual current coverage before moving from personal to shared packing. */
export function personalPackingReady(data: PackingData | null, confirmedIds: readonly string[], synced: boolean): boolean {
  if (!data || !synced || !confirmedIds.length || new Set(confirmedIds).size !== confirmedIds.length) return false;
  const active = data.members.filter(member => member.active !== false);
  const activeIds = new Set(active.map(member => member.id));
  if (active.length !== confirmedIds.length || activeIds.size !== active.length || confirmedIds.some(id => !activeIds.has(id))) return false;
  return data.items.filter(item => item.type === 'personal').every(item => {
    const targets = item.targetMemberIds;
    if (!targets.length || new Set(targets).size !== targets.length || targets.some(id => !activeIds.has(id))) return false;
    return targets.every(memberId => {
      const expectedId = `${item.id}_${memberId}`;
      const rows = data.assignments.filter(row => row.id === expectedId && row.itemId === item.id);
      return rows.length === 1 && rows[0].memberId === memberId && isCurrentAssignment(item, rows[0])
        && (rows[0].status === 'ready' || rows[0].status === 'packed');
    });
  });
}
