import { Timestamp } from 'firebase/firestore';

export type ItemStatus = 'not_ready' | 'ready' | 'packed';
export type QuantityRule = 'per_person' | 'fixed' | 'capacity';
export interface ItemTemplate {
  id: string;
  nameKey: string;
  category: string;
  type: 'personal' | 'shared';
  quantityRule: QuantityRule;
  quantityPerPerson?: number;
  fixedQuantity?: number;
  capacityPerItem?: number;
  unitKey: string;
}
export interface TemplateSelection { template: ItemTemplate; customName?: string }
export const STATUS_LABELS: Record<ItemStatus, string> = {
  not_ready: "Not ready", ready: "Ready", packed: 'Packed',
};
export interface TripItem {
  id: string;
  tripId: string;
  name: string;
  type: 'personal' | 'shared';
  quantity: number;
  targetMemberIds: string[];
  /** Optional explicit targets for a generated personal item in a workspace trip. */
  selectedMemberIds?: string[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  template?: ItemTemplate;
  customName?: boolean;
}
export interface ItemAssignment {
  id: string;
  tripId: string;
  itemId: string;
  memberId: string;
  unitNumber?: number;
  status: ItemStatus;
  bagId?: string;
  updatedAt: Timestamp;
}
export interface PackingMember { id: string; name: string; uid: string; active?: boolean }
export interface PackingBag { id: string; name: string }
export interface PackingData {
  ownerUid: string;
  adminUids: string[];
  members: PackingMember[];
  bags: PackingBag[];
  items: TripItem[];
  assignments: ItemAssignment[];
}
export interface Registration {
  name: string;
  type: 'personal' | 'shared';
  targetMemberIds: string[];
  units: { memberId: string; status: ItemStatus; bagId: string }[];
  status: ItemStatus;
  bagId: string;
}

export function createPackingItem(tripId: string, createdBy: string, input: Registration, members: PackingMember[], bags: PackingBag[], id: string): { item: TripItem; assignments: ItemAssignment[] } {
  const targets = [...new Set(input.targetMemberIds)];
  const count = input.type === 'personal' ? targets.length : input.units.length;
  if (!['personal', 'shared'].includes(input.type) || !input.name.trim() || input.name.trim().length > 200 || count < 1 || count > 100) throw new Error("Enter a name of up to 200 characters and 1–100 targets or units.");
  const memberExists = (memberId: string) => members.some(m => m.id === memberId && m.active !== false);
  const validState = (status: ItemStatus, bagId: string) => Object.hasOwn(STATUS_LABELS, status) && (!bagId || bags.some(b => b.id === bagId));
  if (input.type === 'personal' && (!targets.every(memberExists) || !validState(input.status, input.bagId))) throw new Error("Check target members, status and bag.");
  if (input.type === 'shared' && !input.units.every(u => memberExists(u.memberId) && validState(u.status, u.bagId))) throw new Error("Select an assignee, status and bag for each unit.");
  const now = Timestamp.now();
  const item: TripItem = { id, tripId, name: input.name.trim(), type: input.type, quantity: input.type === 'personal' ? 1 : count, targetMemberIds: input.type === 'personal' ? targets : [], createdBy, createdAt: now, updatedAt: now };
  const assignments: ItemAssignment[] = input.type === 'personal'
    ? targets.map(memberId => ({ id: `${id}_${memberId}`, tripId, itemId: id, memberId, status: input.status, bagId: input.bagId, updatedAt: now }))
    : input.units.map((unit, index) => ({ id: `${id}_unit_${index + 1}`, tripId, itemId: id, ...unit, unitNumber: index + 1, updatedAt: now }));
  return { item, assignments };
}

export function packingProgress(item: TripItem, assignments: ItemAssignment[]) {
  const expected = item.type === 'personal' ? item.targetMemberIds.map(id => `${item.id}_${id}`) : Array.from({ length: item.quantity }, (_, i) => `${item.id}_unit_${i + 1}`);
  const rows = expected.map(id => assignments.find(a => a.id === id && a.itemId === item.id));
  return {
    total: expected.length,
    ready: rows.filter(a => a && a.status !== 'not_ready').length,
    packed: rows.filter(a => a?.status === 'packed').length,
    allPacked: rows.length > 0 && rows.every(a => a?.status === 'packed'),
    notPackedMemberIds: rows.flatMap((a, i) => a?.status !== 'packed' ? [a?.memberId || item.targetMemberIds[i] || ''] : []),
    notReadyMemberIds: rows.flatMap((a, i) => !a || a.status === 'not_ready' ? [a?.memberId || item.targetMemberIds[i] || ''] : []),
  };
}

export function canEditAssignment(data: Pick<PackingData, 'ownerUid' | 'adminUids' | 'members'>, uid: string, assignment: ItemAssignment) {
  return !!uid && (uid === data.ownerUid || data.adminUids.includes(uid) || data.members.some(m => m.id === assignment.memberId && m.uid === uid && m.active !== false));
}

export function requiredQuantity(template: ItemTemplate, memberCount: number): number {
  if (!Number.isSafeInteger(memberCount) || memberCount < 0 || memberCount > 100) throw new Error('Use between 1 and 100 members.');
  const value = template.quantityRule === 'per_person' ? template.quantityPerPerson : template.quantityRule === 'fixed' ? template.fixedQuantity : template.quantityRule === 'capacity' ? template.capacityPerItem : undefined;
  if (!Number.isSafeInteger(value) || !value || value < 1 || value > 100 || (template.type === 'personal' && template.quantityRule !== 'per_person')) throw new Error('Invalid template quantity rule.');
  return template.quantityRule === 'per_person' ? memberCount * value : template.quantityRule === 'fixed' ? value : Math.ceil(memberCount / value);
}

/** Stable IDs let retries and returning members reuse their previous checks. Nothing is deleted. */
export function reconcilePacking(data: PackingData, requested: { id: string; name: string; uid?: string }[], tripId: string, uid: string, selections: TemplateSelection[] = []): PackingData {
  if (!requested.length || requested.length > 100 || new Set(requested.map(m => m.id)).size !== requested.length || requested.some(m => !m.name.trim() || m.name.length > 200)) throw new Error('Use between 1 and 100 members.');
  const ids = requested.map(m => m.id);
  const now = Timestamp.now();
  const members = data.members.map(old => {
    const next = requested.find(m => m.id === old.id);
    return next ? { ...old, name: next.name, active: true } : { ...old, active: false };
  });
  requested.filter(m => !members.some(old => old.id === m.id)).forEach(m => members.push({ id: m.id, name: m.name, uid: m.uid || '', active: true }));
  const items = [...data.items];
  for (const { template, customName } of selections) {
    if (items.some(item => item.id === `template-${template.id}`)) continue;
    items.push({ id: `template-${template.id}`, tripId, name: customName?.trim() || template.nameKey, customName: !!customName?.trim(), type: template.type, quantity: requiredQuantity(template, ids.length), targetMemberIds: template.type === 'personal' ? ids : [], template, createdBy: uid, createdAt: now, updatedAt: now });
  }
  const assignments = [...data.assignments];
  const existing = new Set(assignments.map(a => a.id));
  const reconciled = items.map(item => {
    const targetMemberIds = item.type === 'personal' ? item.template ? item.selectedMemberIds ? ids.filter(id => item.selectedMemberIds!.includes(id)) : ids : item.targetMemberIds.filter(id => ids.includes(id)) : [];
    const quantity = item.template ? requiredQuantity(item.template, item.type === 'personal' ? targetMemberIds.length : ids.length) : item.quantity;
    const changed = quantity !== item.quantity || JSON.stringify(targetMemberIds) !== JSON.stringify(item.targetMemberIds);
    const next = changed ? { ...item, quantity, targetMemberIds, updatedAt: now } : item;
    // Manual items keep their chosen targets. Generated personal rows represent each member's whole allocation.
    const required = item.type === 'personal'
      ? targetMemberIds.map(memberId => ({ id: `${item.id}_${memberId}`, memberId }))
      : Array.from({ length: quantity }, (_, i) => ({ id: `${item.id}_unit_${i + 1}`, memberId: '', unitNumber: i + 1 }));
    for (const row of required) {
      if (existing.has(row.id)) continue;
      assignments.push({ ...row, tripId, itemId: item.id, status: 'not_ready', bagId: '', updatedAt: now });
      existing.add(row.id);
    }
    return next;
  });
  return { ...data, members, items: reconciled, assignments };
}

export function isCurrentAssignment(item: TripItem, assignment: ItemAssignment) {
  return assignment.itemId === item.id && (item.type === 'personal' ? item.targetMemberIds.includes(assignment.memberId) : !!assignment.unitNumber && assignment.unitNumber <= item.quantity);
}

export function packingItemName(item: TripItem, t: (key: string) => string) {
  return item.template && !item.customName ? t(item.template.nameKey) : item.name;
}

// localStorage does not preserve Timestamp prototypes.
export function restorePackingData(value: PackingData): PackingData {
  const timestamp = (t: Timestamp | { seconds: number; nanoseconds: number }) => t instanceof Timestamp ? t : new Timestamp(t.seconds, t.nanoseconds);
  return { ...value, items: value.items.map(i => ({ ...i, createdAt: timestamp(i.createdAt), updatedAt: timestamp(i.updatedAt) })), assignments: value.assignments.map(a => ({ ...a, updatedAt: timestamp(a.updatedAt) })) };
}
