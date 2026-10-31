import { canManage, canRecord } from '#lib/server/orgs.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => ({
  userName: locals.session?.userName ?? null,
  member: locals.member,
  orgCount: locals.memberships.length,
  /** What the navigation and pages offer; every action checks again on the server. */
  can: {
    record: canRecord(locals.member),
    manage: canManage(locals.member),
  },
});
