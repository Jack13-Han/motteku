import { isCurrentAssignment, type ItemAssignment, type PackingData, type PackingMember, type TripItem } from './packing';

type ReadinessTime = { seconds: number; nanoseconds: number } | null;
export type DepartureRequirement = { itemId: string; createdBy: string; createdAt: ReadinessTime };
export type DepartureConfirmation = { uid: string; memberId: string; contextHash: string; confirmedAt: ReadinessTime };
export type RequiredCheck = { itemId: string; memberId: string; assignmentId: string; shared: boolean; packed: boolean };

function time(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') return null;
  const stamp = value as { seconds?: unknown; nanoseconds?: unknown };
  return typeof stamp.seconds === 'number' && typeof stamp.nanoseconds === 'number' ? [stamp.seconds, stamp.nanoseconds] : null;
}

/** Count only each canonical current row once. Missing or unassigned units remain blocking. */
export function requiredChecks(data: PackingData, requirements: DepartureRequirement[]): RequiredCheck[] {
  const active = new Set(data.members.filter(member => member.active !== false).map(member => member.id));
  return [...new Set(requirements.map(requirement => requirement.itemId))].sort().flatMap(itemId => {
    const item = data.items.find(row => row.id === itemId);
    if (!item) return [{ itemId, memberId: '', assignmentId: '', shared: true, packed: false }];
    const slots = item.type === 'personal'
      ? [...new Set(item.targetMemberIds)].filter(id => active.has(id)).sort().map(memberId => ({ id: `${item.id}_${memberId}`, memberId, unitNumber: 0 }))
      : Array.from({ length: Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100 ? item.quantity : 0 }, (_, index) => ({ id: `${item.id}_unit_${index + 1}`, memberId: '', unitNumber: index + 1 }));
    if (!slots.length) return [{ itemId, memberId: '', assignmentId: '', shared: true, packed: false }];
    return slots.map(slot => {
      const matches = data.assignments.filter(row => row.id === slot.id && isCurrentAssignment(item, row) && (item.type !== 'shared' || row.unitNumber === slot.unitNumber));
      const row = matches.length === 1 ? matches[0] : undefined;
      const assigned = !!row && active.has(row.memberId) && (item.type === 'shared' || row.memberId === slot.memberId);
      return { itemId, assignmentId: slot.id, memberId: item.type === 'personal' ? slot.memberId : row?.memberId || '', shared: item.type === 'shared', packed: assigned && row?.status === 'packed' };
    });
  });
}

export function linkedReadinessMember(data: PackingData, uid: string): PackingMember | undefined {
  const members = data.members.filter(member => member.active !== false && member.uid === uid);
  return uid && members.length === 1 ? members[0] : undefined;
}

const assignmentValue = (assignment: ItemAssignment | undefined) => assignment ? [assignment.id, assignment.itemId, assignment.memberId, assignment.unitNumber || 0, assignment.status, assignment.bagId || '', time(assignment.updatedAt)] : null;
const itemValue = (item: TripItem | undefined) => item ? [item.id, item.type, item.quantity, [...item.targetMemberIds].sort(), item.name, time(item.updatedAt)] : null;

/** Versioned deterministic declaration context; the hash is not an authorization token. */
export function readinessContext(data: PackingData, requirements: DepartureRequirement[], memberId: string, scope = ''): string {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const roster = data.members.filter(member => member.active !== false).map(member => [member.id, member.uid]).sort((a, b) => compare(a[0], b[0]));
  const checks = requiredChecks(data, requirements);
  const relevant = checks.filter(check => check.shared || check.memberId === memberId);
  return JSON.stringify({ version: 1, scope, memberId, roster,
    requirements: [...requirements].sort((a, b) => compare(a.itemId, b.itemId)).map(requirement => [requirement.itemId, requirement.createdBy, time(requirement.createdAt), itemValue(data.items.find(item => item.id === requirement.itemId))]),
    checks: relevant.map(check => [check.itemId, check.assignmentId, check.memberId, check.packed, assignmentValue(data.assignments.find(row => row.id === check.assignmentId))]),
  });
}

export async function hashReadinessContext(context: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function departureSummary(data: PackingData, requirements: DepartureRequirement[], confirmations: DepartureConfirmation[], hashes: Record<string, string>) {
  const checks = requiredChecks(data, requirements);
  const members = data.members.filter(member => member.active !== false).map(member => {
    const linked = !!member.uid && linkedReadinessMember(data, member.uid)?.id === member.id;
    const blocked = checks.filter(check => !check.packed && (check.shared || check.memberId === member.id));
    const confirmation = confirmations.find(row => row.uid === member.uid && row.memberId === member.id);
    const current = !!hashes[member.id] && confirmation?.contextHash === hashes[member.id];
    return { member, linked, blocked, confirmed: linked && !blocked.length && current, stale: !!confirmation && !current };
  });
  return { checks, members, packed: checks.filter(check => check.packed).length, total: checks.length,
    ready: members.length > 0 && checks.every(check => check.packed) && members.every(member => member.confirmed),
  };
}

export function readinessError(error: unknown, action: 'load' | 'save' | 'hash'): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace(/^firestore\//, '') : '';
  if (code === 'permission-denied' || code === 'unauthenticated') return 'Readiness access denied. Check membership and publish the latest Firestore rules.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Readiness could not sync. Check your connection and try again.';
  return action === 'load' ? 'Could not load departure readiness.' : action === 'hash' ? 'Could not check readiness. Use a secure browser connection and try again.' : 'Could not save departure readiness. Try again.';
}
