import { expect, test } from '@playwright/test';

test('the games list filters by player and date, and a game can be corrected', async ({ page }) => {
  await page.goto('/games');
  const rows = page.locator('ul.list > li');
  await expect(rows).toHaveCount(3);

  // From one player's point of view: won or lost.
  await page.getByLabel('Player').selectOption({ label: 'Ann Lee' });
  await expect(page).toHaveURL(/player=\d+/);
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('lost'); // 7 Oct: Ann on blue, 9:10
  await page.getByLabel('From').fill('2026-10-06');
  await page.getByLabel('From').dispatchEvent('change');
  await expect(rows).toHaveCount(2);
  await page.getByRole('link', { name: 'Clear' }).click();
  await expect(rows).toHaveCount(3);

  // Correct the 6 Oct game: it was 8:10, with Eve in Dan's place.
  await page.getByRole('link', { name: /6 to 10/ }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('red score').fill('8');
  await page.getByLabel('blue offense').selectOption({ label: 'Cat' });
  await page.getByLabel('red defense').selectOption({ label: 'Dan' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.locator('.team.red .score')).toHaveText('8');
  await expect(page.locator('.team.blue')).toContainText('Cat');

  // A player twice is refused, with the reason.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('blue defense').selectOption({ label: 'Ann Lee' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('different person');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Delete asks first.
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(rows).toHaveCount(2);
});

test('the roster: add, rename, archive and restore', async ({ page }) => {
  await page.goto('/players');
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByLabel('First name').fill('Fay');
  await page.getByLabel('Last name').fill('Wu');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fay Wu' })).toBeVisible();
  await expect(page.getByText('No games yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('First name').fill('Faye');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Faye Wu' })).toBeVisible();

  // Never played: deleting removes her for good.
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/players$/);
  await expect(page.getByRole('link', { name: 'Faye Wu' })).toHaveCount(0);

  // Someone with games is archived instead, and can come back.
  await page.getByRole('link', { name: 'Eve' }).click();
  await expect(page.locator('ul.list > li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('archived', { exact: true })).toBeVisible();
  await page.goto('/players');
  await expect(page.getByRole('link', { name: 'Eve' })).toHaveCount(0);
  await page.getByRole('link', { name: /Archived \(1\)/ }).click();
  await page.getByRole('link', { name: 'Eve' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('archived', { exact: true })).toHaveCount(0);
});
