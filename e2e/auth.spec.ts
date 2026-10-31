import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const links = JSON.parse(readFileSync(join(import.meta.dirname, '.auth', 'links.json'), 'utf8')) as {
  admin: string;
  viewer: string;
};

/** Chromium's virtual authenticator stands in for Touch ID and answers the prompt itself. */
async function withPasskeys(context: BrowserContext, page: Page) {
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

test('signed out, every page leads to sign-in', async ({ page }) => {
  await page.goto('/games?from=2026-01-01');
  await expect(page).toHaveURL(/\/login\?next=%2Fgames%3Ffrom%3D2026-01-01$/);
  // Before anyone has an account, the page says how the first one is made.
  await expect(page.getByText('Nobody has an account yet.')).toBeVisible();
});

test('an invite creates the account with a passkey, which then signs in', async ({ page, context }) => {
  await withPasskeys(context, page);

  await page.goto(`/invite/${links.admin}`);
  await expect(page.getByRole('heading', { name: 'Office' })).toBeVisible();
  await expect(page.getByText('playing as Ann Lee')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Ann');
  await page.getByRole('button', { name: 'Create passkey and join' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You play as Ann Lee')).toBeVisible();
  await expect(page.locator('header')).toContainText('admin');

  // The link is spent.
  await page.goto(`/invite/${links.admin}`);
  await expect(page.getByText('already used or has expired')).toBeVisible();

  // Sign out, and back in with the same passkey.
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You play as Ann Lee')).toBeVisible();

  // Signed in, another invite joins with this account instead of making a new one.
  await page.goto(`/invite/${links.viewer}`);
  await expect(page.getByText('You’re already a member')).toBeVisible();
});

test('an invite without a player makes someone who can watch but not record', async ({ page, context }) => {
  await withPasskeys(context, page);
  await page.goto(`/invite/${links.viewer}`);
  await page.getByLabel('Your name').fill('Vic');
  await page.getByRole('button', { name: 'Create passkey and join' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('To record them, ask an admin to link you to a player.')).toBeVisible();
});
