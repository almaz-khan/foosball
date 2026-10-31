import { expect, test } from '@playwright/test';

test('the dashboard ranks the players, highlights you, and switches period', async ({ page }) => {
  await page.goto('/');
  const table = page.getByRole('table');
  await expect(table).toBeVisible();

  // Every seeded player has three games, so everyone is ranked; Ann's own row stands out.
  const annRow = table.locator('tr.mine');
  await expect(annRow).toContainText('Ann Lee');
  await expect(table.locator('tbody tr').first().locator('td.rank')).toHaveText('1');
  await expect(page.getByRole('region', { name: 'Your record' })).toContainText('played');

  await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible();
  await page.getByRole('link', { name: 'All games' }).click();
  await expect(page).toHaveURL(/\/games$/);

  // Periods are links, so a period can be bookmarked.
  await page.goto('/');
  await page.getByRole('link', { name: 'This year' }).click();
  await expect(page).toHaveURL(/\?period=year$/);
  await expect(page.getByRole('link', { name: 'This year' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'All time' }).click();
  await expect(page).toHaveURL(/\/$/);
});
