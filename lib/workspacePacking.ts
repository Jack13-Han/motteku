import { Timestamp } from 'firebase/firestore';
import { packingProgress, reconcilePacking, requiredQuantity, type ItemAssignment, type ItemStatus, type PackingData, type PackingMember, type TemplateSelection, type TripItem } from './packing';

export type WorkspaceItem = Partial<TripItem> & {
  id: string; name: string; category: string; status: string; assignee: string;
  weight: number; price: number; paidBy: string; comment: string; dueDate: string; receiptUrl: string;
  bagId?: string; bagLocation?: string;
};
export type ConfirmedPackingSelection = TemplateSelection & {
  quantity?: number; category?: string; status?: string; assignee?: string; memberId?: string; bagId?: string;
  targetMemberIds?: string[]; assignments?: ItemAssignment[];
  units?: { memberId: string; status: ItemStatus; bagId: string }[];
};
export type WorkspaceTrip = {
  id: string; members: { id: string; name: string; uid?: string }[]; items: WorkspaceItem[];
  bags?: { id: string; name: string }[]; pendingPacking?: ConfirmedPackingSelection[];
  itemAssignments?: ItemAssignment[]; packingMembers?: PackingMember[]; packingAdminUids?: string[];
};
export type WorkspaceDocument = { trips: WorkspaceTrip[]; activeTripId: string; [key: string]: unknown };

export function isWorkspacePackingItem(item: WorkspaceItem): item is WorkspaceItem & TripItem {
  return (item.type === 'personal' || item.type === 'shared') && Array.isArray(item.targetMemberIds) && !!item.tripId;
}
export function workspacePackingData(trip: WorkspaceTrip, uid: string): PackingData {
  return {
    ownerUid: uid, adminUids: trip.packingAdminUids || [], bags: trip.bags || [],
    members: trip.packingMembers || trip.members.map(m => ({ ...m, uid: m.uid || (m.name === 'Me' ? uid : '') })),
    items: trip.items.filter(isWorkspacePackingItem), assignments: trip.itemAssignments || [],
  };
}
const legacyStatus = (status: ItemStatus) => status === 'packed' ? 'Packed' : status === 'ready' ? 'Owned' : 'Need to buy';
const assignmentStatus = (status?: string): ItemStatus => status === 'packed' || status === 'Packed' ? 'packed' : ['ready', 'Owned', 'Purchased'].includes(status || '') ? 'ready' : 'not_ready';
const defaults = (item: TripItem): WorkspaceItem => ({ ...item, category: item.template?.category || 'General', status: 'Need to buy', assignee: 'Unassigned', weight: 0, price: 0, paidBy: '', comment: '', dueDate: '', receiptUrl: '', bagId: '', bagLocation: '' });

/** Keep shopping metadata and legacy items while storing actual packing items in the trip array. */
export function storeWorkspacePacking<T extends WorkspaceTrip>(trip: T, next: PackingData): T {
  const previous = new Map(trip.items.map(item => [item.id, item]));
  const items = next.items.map(item => {
    const old = previous.get(item.id);
    const progress = packingProgress(item, next.assignments);
    const rows = next.assignments.filter(a => a.itemId === item.id);
    return { ...defaults(item), ...old, ...item,
      status: progress.allPacked ? 'Packed' : progress.total > 0 && progress.ready === progress.total ? (old?.status === 'Purchased' ? 'Purchased' : 'Owned') : 'Need to buy',
      assignee: item.type === 'shared' && rows.length && rows.every(a => a.memberId === rows[0].memberId) ? next.members.find(m => m.id === rows[0].memberId)?.name || old?.assignee || 'Unassigned' : old?.assignee || 'Unassigned',
    };
  });
  return { ...trip, items: [...trip.items.filter(item => !isWorkspacePackingItem(item) && !next.items.some(nextItem => nextItem.id === item.id)), ...items], itemAssignments: next.assignments, packingMembers: next.members, packingAdminUids: next.adminUids, bags: next.bags };
}

/** Pure, deterministic conversion. Existing item/assignment IDs always win on retry. */
export function convertPendingPacking<T extends WorkspaceTrip>(trip: T, uid: string): T {
  if (!trip.pendingPacking?.length) return trip;
  const original = workspacePackingData(trip, uid);
  const members = trip.members;
  let data = original;
  for (const pending of trip.pendingPacking) {
    const template = pending.template;
    const id = `template-${template.id}`;
    const old = trip.items.find(item => item.id === id);
    const selection = { quantity: old?.quantity, category: old?.category, status: old?.status, assignee: old?.assignee, bagId: old?.bagId, ...pending };
    const requested = selection.targetMemberIds ? members.filter(m => selection.targetMemberIds!.includes(m.id)) : members;
    if (template.type === 'personal' && !requested.length) throw new Error('Use between 1 and 100 members.');
    const exists = data.items.some(item => item.id === id);
    const generated = reconcilePacking({ ...data, items: [], assignments: [] }, members, trip.id, uid, [selection]);
    const item = generated.items[0];
    item.quantity = template.type === 'personal' ? requiredQuantity(template, requested.length) : selection.quantity ?? item.quantity;
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > (template.type === 'personal' ? 10000 : 100)) throw new Error('Required quantity must be between 1 and 100.');
    item.targetMemberIds = template.type === 'personal' ? requested.map(m => m.id) : [];
    if (template.type === 'personal' && selection.targetMemberIds) item.selectedMemberIds = [...selection.targetMemberIds];
    if (template.type === 'shared' && item.quantity !== requiredQuantity(template, members.length)) {
      item.template = { ...template, quantityRule: 'fixed', fixedQuantity: item.quantity };
    }
    const owner = selection.memberId || members.find(m => m.id === selection.assignee || m.name === selection.assignee)?.id || '';
    const expected: { id: string; memberId: string; unitNumber?: number }[] = template.type === 'personal'
      ? requested.map(m => ({ id: `${id}_${m.id}`, memberId: m.id }))
      : Array.from({ length: item.quantity }, (_, i) => ({ id: `${id}_unit_${i + 1}`, memberId: selection.units?.[i]?.memberId || owner, unitNumber: i + 1 }));
    const rows = expected.map(row => {
      const unit = row.unitNumber ? selection.units?.[row.unitNumber - 1] : undefined;
      return selection.assignments?.find(a => a.id === row.id) || { ...row, tripId: trip.id, itemId: id, status: unit?.status || assignmentStatus(selection.status), bagId: unit?.bagId ?? selection.bagId ?? '', updatedAt: Timestamp.now() };
    });
    data = { ...data, members: generated.members,
      items: exists ? data.items : [...data.items, { ...item, ...(selection.category ? { category: selection.category } : {}) }],
      assignments: [...data.assignments, ...rows.filter(row => !data.assignments.some(a => a.id === row.id))],
    };
  }
  const result = storeWorkspacePacking(trip, data);
  result.items = result.items.map(item => {
    const selection = trip.pendingPacking!.find(s => item.id === `template-${s.template.id}`);
    if (!selection || trip.items.some(old => old.id === item.id)) return item;
    return { ...item, category: selection.category ?? selection.template.category ?? item.category,
      status: selection.status ? (['Owned', 'Need to buy', 'Purchased', 'Packed'].includes(selection.status) ? selection.status : legacyStatus(assignmentStatus(selection.status))) : item.status,
      assignee: selection.assignee ?? (selection.memberId ? members.find(m => m.id === selection.memberId)?.name || selection.memberId : item.assignee),
      bagId: selection.bagId ?? item.bagId,
    };
  });
  return { ...result, pendingPacking: [] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Apply only locally changed fields to the freshest document, preserving unrelated trips/fields. */
export function mergeWorkspaceChanges<T>(before: T, after: T, current: T): T {
  if (same(before, after)) return current;
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current) && [...before, ...after, ...current].every(v => v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string')) {
    const old = new Map(before.map(v => [v.id, v])), next = new Map(after.map(v => [v.id, v]));
    const merged = current.filter(v => !old.has(v.id) || next.has(v.id)).map(v => old.has(v.id) && next.has(v.id) ? mergeWorkspaceChanges(old.get(v.id), next.get(v.id), v) : v);
    after.forEach(v => { if (!old.has(v.id) && !merged.some(m => m.id === v.id)) merged.push(v); });
    return merged as T;
  }
  if (before && after && current && Object.getPrototypeOf(before) === Object.prototype && Object.getPrototypeOf(after) === Object.prototype && Object.getPrototypeOf(current) === Object.prototype) {
    const old = before as Record<string, unknown>, next = after as Record<string, unknown>, merged = { ...current } as Record<string, unknown>;
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (same(old[key], next[key])) continue;
      if (!(key in next) || next[key] === undefined) delete merged[key];
      else merged[key] = key in old && key in merged ? mergeWorkspaceChanges(old[key], next[key], merged[key]) : next[key];
    }
    return merged as T;
  }
  return after;
}

export function replaceWorkspaceTrip<W extends WorkspaceDocument>(workspace: W, tripId: string, change: (trip: WorkspaceTrip) => WorkspaceTrip, create?: WorkspaceTrip): W {
  const trip = workspace.trips.find(t => t.id === tripId) || create;
  if (!trip || trip.id !== tripId) throw new Error('Trip could not be loaded.');
  const updated = change(trip);
  return { ...workspace, trips: workspace.trips.some(t => t.id === tripId) ? workspace.trips.map(t => t.id === tripId ? updated : t) : [...workspace.trips, updated] };
}
