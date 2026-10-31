import { expect, test } from '@playwright/test';
import { withPasskeys } from './passkeys.ts';

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
  await withPasskeys(hal, halPage);
  await halPage.goto(link);
  await expect(halPage.getByText('playing as Hal Ito')).toBeVisible();
  await halPage.getByRole('button', { name: 'Create passkey and join' }).click();
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

  // Unlink him: he only watches now. Then a recovery link for him.
  await halRow.getByLabel('Player').selectOption({ label: '— none (watches) —' });
  await expect(halRow).toContainText('watches: no player');
  await halRow.getByRole('button', { name: 'Recovery link' }).click();
  await expect(page.getByText('A link that adds a passkey to Hal Ito’s account')).toBeVisible();
  await expect(page.getByLabel('Link')).toHaveValue(/\/login\?enroll=/);

  // Ann can't demote herself while she is the only admin.
  const annRow = memberRow('Ann');
  await annRow.getByLabel('Role').selectOption('member');
  await expect(page.getByRole('alert')).toContainText('at least one admin');
});

test('your account: name, passkeys, a link for another device', async ({ page, context }) => {
  await withPasskeys(context, page);
  await page.goto('/');
  await page.locator('header').getByRole('link', { name: /Ann/ }).click();
  await expect(page).toHaveURL(/\/account$/);

  // Her only passkey lives in the setup browser; it is this session's, and can't be removed alone.
  const keys = page.locator('.rows').first().locator('li');
  await expect(keys).toHaveCount(1);
  await expect(keys.first()).toContainText('this browser');
  await keys.first().getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove and sign out' }).click();
  await expect(page.getByRole('alert')).toContainText('only passkey');

  // A second passkey, here; renamed.
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(keys).toHaveCount(2);
  await keys.nth(1).getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Passkey name').fill('Work laptop');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(keys.nth(1)).toContainText('Work laptop');

  await page.getByRole('button', { name: 'Link for another device' }).click();
  await expect(page.getByLabel('Link')).toHaveValue(/\/login\?enroll=/);

  // Now the extra one can go.
  await keys.nth(1).getByRole('button', { name: 'Remove' }).click();
  await keys.nth(1).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(keys).toHaveCount(1);
});
