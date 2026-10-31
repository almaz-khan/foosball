import { expect, test as setup } from '@playwright/test';
import { join } from 'node:path';
import { links, withPasskeys } from './passkeys.ts';

/**
 * Ann joins the way a person does the first time: open the invite, create a
 * passkey. The session cookie is saved for the app specs, which start signed in.
 */
setup('Ann joins the office from her invite', async ({ page, context }) => {
  await withPasskeys(context, page);

  await page.goto(`/invite/${links.admin}`);
  await expect(page.getByRole('heading', { name: 'Office' })).toBeVisible();
  await expect(page.getByText('as an admin, playing as Ann Lee')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Ann');
  await page.getByRole('button', { name: 'Create passkey and join' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You play as Ann Lee')).toBeVisible();
  await expect(page.locator('header')).toContainText('admin');

  // The link is spent.
  await page.goto(`/invite/${links.admin}`);
  await expect(page.getByText('already used or has expired')).toBeVisible();

  await context.storageState({ path: join(import.meta.dirname, '.auth', 'ann.json') });
});
