import { expect, test } from '@playwright/test';
import { HUB_PORT, hubSignsIn } from './hub.ts';

test('an admin invites someone from the app; they join from another browser', async ({ page, browser }) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByLabel('Their name').fill('Hal Ito');
  await expect(page.getByLabel('First name')).toHaveValue('Hal');
  await expect(page.getByLabel('Last name')).toHaveValue('Ito');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.getByText('Invite for Hal Ito')).toBeVisible();
  const link = await page.getByLabel('Link').inputValue();
  expect(link).toMatch(/\/invite\/[\w-]+$/);
  await expect(page.locator('.rows li', { hasText: 'Hal Ito' })).toContainText('as Hal Ito');

  // Hal, on his own device.
  // A clean browser: new contexts in a test inherit the project's options, Ann's session included.
  const hal = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const halPage = await hal.newPage();
  await hubSignsIn('hal', 'Hal Ito');
  await halPage.goto(link);
  await expect(halPage.getByText('playing as Hal Ito')).toBeVisible();
  await halPage.getByRole('button', { name: 'Join as Hal Ito' }).click();
  await expect(halPage).toHaveURL(/\/$/);
  await expect(halPage.getByRole('link', { name: 'Record a game' })).toBeVisible();
  await expect(halPage.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await hal.close();

  // Back with Ann: Hal is a member now, and the invite is gone.
  await page.reload();
  // Rows by the member's name: player names also appear in every row's player picker.
  const memberRow = (name: string) => page.locator('.members > li').filter({ has: page.locator('.who strong', { hasText: name }) });
  const halRow = memberRow('Hal Ito');
  await expect(halRow).toContainText('plays as Hal Ito');
  await expect(page.locator('.rows li', { hasText: 'as Hal Ito ·' })).toHaveCount(0);

  // Unlink him: he only watches now.
  await halRow.getByLabel('Player').selectOption({ label: '— none (watches) —' });
  await expect(halRow).toContainText('watches: no player');

  // Ann can't demote herself while she is the only admin.
  const annRow = memberRow('Ann');
  await annRow.getByLabel('Role').selectOption('member');
  await expect(page.getByRole('alert')).toContainText('at least one admin');
});

test('your account: name, and passkeys at the hub', async ({ page }) => {
  await page.goto('/');
  await page.locator('header').getByRole('link', { name: /Ann/ }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('Ann', { exact: true })).toBeVisible();
  // Passkeys are added and removed at the hub, shared by every app.
  await expect(page.getByRole('link', { name: `localhost:${HUB_PORT}` })).toHaveAttribute('href', `http://localhost:${HUB_PORT}/`);
});
