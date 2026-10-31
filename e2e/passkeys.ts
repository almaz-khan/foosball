import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Invite links e2e/serve.ts made for this run. */
export const links = JSON.parse(readFileSync(join(import.meta.dirname, '.auth', 'links.json'), 'utf8')) as {
  admin: string;
  newcomer: string;
  viewer: string;
};

/** Chromium's virtual authenticator stands in for Touch ID and answers the prompt itself. */
export async function withPasskeys(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
