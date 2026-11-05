import { error } from '@sveltejs/kit';
import { canManage, canRecord, type Membership } from './orgs.ts';

/** The org the person last chose, for someone in more than one. */
export const ORG_COOKIE = 'foosball_org';

export const orgCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 365,
};

/** The membership a request acts on: the one the org cookie names, else the oldest. */
export function currentMembership(all: Membership[], slug: string | undefined): Membership | null {
  return all.find((m) => m.orgSlug === slug) ?? all[0] ?? null;
}

// ---------------------------------------------------------------- what a request may do

/** The signed-in person's account; hooks have already sent anyone signed out to the hub. */
export function requireSession(locals: App.Locals): NonNullable<App.Locals['session']> {
  if (!locals.session) error(401, 'Sign in first.');
  return locals.session;
}

/** Any member of the current org may look. */
export function requireMember(locals: App.Locals): Membership {
  requireSession(locals);
  if (!locals.member) error(403, 'You are not a member of any org yet. Ask an admin for an invite.');
  return locals.member;
}

/** Recording games is for members who are a player. */
export function requireRecorder(locals: App.Locals): Membership & { playerId: number } {
  const member = requireMember(locals);
  if (!canRecord(member)) error(403, 'Only members linked to a player can record games. Ask an admin to link you.');
  return member as Membership & { playerId: number };
}

export function requireAdmin(locals: App.Locals): Membership {
  const member = requireMember(locals);
  if (!canManage(member)) error(403, 'Only the org’s admins can do that.');
  return member;
}
