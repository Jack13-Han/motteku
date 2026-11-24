import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrip, normalizeInviteCode, invitationUsable, safeReturnPath } from '../lib/trips.ts';

const input = { name: '旅行名 is user data', type: 'camping', mode: 'group', destination: 'Osaka', startDate: '2026-11-01', endDate: '2026-11-03', plannedMemberCount: 5, description: 'Untranslated description' };
test('draft inputs validate member estimates and real calendar dates', () => {
  assert.doesNotThrow(() => validateTrip(input));
  for (const patch of [{ name: ' ' }, { type: 'invalid' }, { startDate: '2026-02-30' }, { endDate: '2026-10-01' }, { plannedMemberCount: 0 }, { plannedMemberCount: 1.5 }, { plannedMemberCount: 101 }]) assert.throws(() => validateTrip({ ...input, ...patch }));
  assert.equal(input.name, '旅行名 is user data');
});

test('group creation can defer all trip details while single trips require complete dates and exactly one member', () => {
  const group = { ...input, destination: '', startDate: '', endDate: '', description: '' };
  assert.doesNotThrow(() => validateTrip(group, true));
  assert.throws(() => validateTrip(group));
  for (const patch of [{ destination: 'Osaka' }, { startDate: '2026-11-01' }, { description: 'Partial details' }, { plannedMemberCount: 1 }]) assert.throws(() => validateTrip({ ...group, ...patch }, true));
  assert.doesNotThrow(() => validateTrip({ ...input, mode: 'single', plannedMemberCount: 1 }));
  assert.throws(() => validateTrip({ ...input, mode: 'single', plannedMemberCount: 2 }));
  assert.throws(() => validateTrip({ ...group, mode: 'single', plannedMemberCount: 1 }, true));
});
test('invite codes normalize only formatting and enforce expiry and limits', () => {
  assert.equal(normalizeInviteCode(' abcd-efgh-2345-6789 '), 'ABCDEFGH23456789');
  const invite = { isActive: true, usedCount: 0, maxUses: 2, expiresAt: { toMillis: () => 2000 } };
  assert.equal(invitationUsable(invite, 1000), true);
  assert.equal(invitationUsable({ ...invite, usedCount: 2 }, 1000), false);
  assert.equal(invitationUsable({ ...invite, isActive: false }, 1000), false);
  assert.equal(invitationUsable(invite, 2000), false);
});
test('authentication returns to invitation pages and rejects external redirect paths', () => {
  assert.equal(safeReturnPath('/join/ABCD2345EFGH6789'), '/join/ABCD2345EFGH6789');
  assert.equal(safeReturnPath('/trips/new'), '/trips/new');
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2f%2fevil.example', null]) assert.equal(safeReturnPath(target), '/');
});
