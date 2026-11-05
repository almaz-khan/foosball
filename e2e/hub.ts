import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where e2e/serve.ts runs the fake login hub (scripts/fakehub.ts). */
export const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 5183);

/** Invite links e2e/serve.ts made for this run. */
export const links = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, '.auth', 'links.json'), 'utf8')) as {
    admin: string;
    newcomer: string;
    viewer: string;
  };

/**
 * Who the fake hub signs in next, as if that person came to the hub with
 * their passkey. Its own session ends, so the next sign-in is theirs.
 */
export async function hubSignsIn(sub: string, name: string): Promise<void> {
  const response = await fetch(`http://localhost:${HUB_PORT}/test/person`, {
    method: 'POST',
    body: JSON.stringify({ sub, name, amr: ['passkey'] }),
  });
  if (!response.ok) throw new Error(`fake hub: ${response.status}`);
}
