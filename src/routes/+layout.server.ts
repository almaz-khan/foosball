import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => ({
  userName: locals.session?.userName ?? null,
  member: locals.member,
  orgCount: locals.memberships.length,
});
