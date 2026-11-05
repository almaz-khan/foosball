import { expect, test as setup } from '@playwright/test';
import { join } from 'node:path';
import { hubSignsIn, links } from './hub.ts';

/**
 * Ann joins the way a person does the first time: open the invite, sign in at
 * the login hub (the fake one from e2e/serve.ts, which needs no screen), come
 * back to the invite and join. The session cookie is saved for the app specs,
 * which start signed in.
 */
setup('Ann joins the office from her invite', async ({ page, context }) => {
  await hubSignsIn('ann', 'Ann');

  await page.goto(`/invite/${links().admin}`);
  await expect(page).toHaveURL(new RegExp(`/invite/${links().admin}$`));
  await expect(page.getByRole('heading', { name: 'Office' })).toBeVisible();
  await expect(page.getByText('as an admin, playing as Ann Lee')).toBeVisible();
  await page.getByRole('button', { name: 'Join as Ann' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: 'Your record' })).toBeVisible();
  await expect(page.locator('header')).toContainText('admin');

  // The link is spent.
  await page.goto(`/invite/${links().admin}`);
  await expect(page.getByText('already used or has expired')).toBeVisible();

  await context.storageState({ path: join(import.meta.dirname, '.auth', 'ann.json') });
});
