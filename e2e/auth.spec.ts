import { expect, test } from '@playwright/test';
import { HUB_PORT, hubSignsIn, links } from './hub.ts';

test('signed out, a page goes through the hub and back to it', async ({ page }) => {
  await hubSignsIn('zoe', 'Zoe');
  await page.goto('/games?from=2026-01-01');
  await expect(page).toHaveURL(/\/games\?from=2026-01-01$/);
  // The hub let her in, but no invite has: an account in no org.
  await expect(page.getByText('not a member of any org')).toBeVisible();
});

test('an invite opened signed out signs in at the hub, then joins; signing out goes through the hub', async ({ page }) => {
  await hubSignsIn('ben', 'Ben Ng');
  await page.goto(`/invite/${links().newcomer}`);
  await expect(page.getByText('playing as Ben Ng')).toBeVisible();
  await page.getByRole('button', { name: 'Join as Ben Ng' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('header')).toContainText('Ben');
  await expect(page.getByRole('link', { name: 'Record a game' })).toBeVisible();

  // Out of Foosball, and on through the hub's sign-out, back to /login.
  const toHub = page.waitForRequest((r) => r.url().startsWith(`http://localhost:${HUB_PORT}/logout`));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await toHub;
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('You’re signed out.')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('header')).toContainText('Ben');
  await expect(page.getByRole('link', { name: 'Record a game' })).toBeVisible();

  // Signed in, another invite to the same org says so instead of joining twice.
  await page.goto(`/invite/${links().viewer}`);
  await expect(page.getByText('You’re already a member')).toBeVisible();
});

test('an invite without a player makes someone who can watch but not record', async ({ page }) => {
  await hubSignsIn('vic', 'Vic');
  await page.goto(`/invite/${links().viewer}`);
  await page.getByRole('button', { name: 'Join as Vic' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('To record them, ask an admin to link you to a player.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Play', exact: true })).toHaveCount(0);

  // Watchers see the history, but no editing.
  await page.goto('/games');
  await page.getByRole('link', { name: /10 to 4/ }).click();
  await expect(page.getByText('Recorder unknown')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
