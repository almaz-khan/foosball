import type { Session } from '#foosball/sessions.ts';
import type { Membership } from '#lib/server/orgs.ts';

declare global {
  namespace App {
    interface Locals {
      session: Session | null;
      /** Every org the signed-in person belongs to; empty when signed out. */
      memberships: Membership[];
      /** The org this request acts on; null when signed out or in no org. */
      member: Membership | null;
    }
  }
}
export {};
