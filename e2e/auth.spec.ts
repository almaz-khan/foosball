import { expect, test } from '@playwright/test';
import { links, withPasskeys } from './passkeys.ts';

test('signed out, every page leads to sign-in and back', async ({ page }) => {
  await page.goto('/games?from=2026-01-01');
  await expect(page).toHaveURL(/\/login\?next=%2Fgames%3Ffrom%3D2026-01-01$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('an invite creates an account with a passkey, which then signs in again', async ({ page, context }) => {
  await withPasskeys(context, page);

  await page.goto(`/invite/${links.newcomer}`);
  await expect(page.getByText('playing as Ben Ng')).toBeVisible();
  await page.getByRole('button', { name: 'Create passkey and join' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You play as Ben Ng')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You play as Ben Ng')).toBeVisible();

  // Signed in, another invite to the same org says so instead of making a second account.
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
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Play', exact: true })).toHaveCount(0);

  // Watchers see the history, but no editing.
  await page.goto('/games');
  await page.getByRole('link', { name: /10 to 4/ }).click();
  await expect(page.getByText('Recorder unknown')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
