import { expect, test } from '@playwright/test';

test('record a game at the table: seat, play, survive a reload, save', async ({ page }) => {
  await page.goto('/play');
  const chip = (name: string) => page.locator('button.chip', { hasText: name });

  await expect(page.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await chip('Ann Lee').click();
  await chip('Cat').click();
  await chip('Dan').click();

  // A guest, added on the spot into the seat chosen for them.
  await page.getByRole('button', { name: 'Defense Empty' }).click();
  await expect(page.getByRole('heading', { name: 'Who plays blue defense?' })).toBeVisible();
  await page.getByRole('button', { name: '+ Guest' }).click();
  await page.getByLabel('First name').fill('Gus');
  await page.getByRole('button', { name: 'Add and seat' }).click();
  await expect(page.locator('.team.blue')).toContainText('Gus');

  // Ann and Cat trade places; a reload keeps the table as it is.
  await page.getByRole('button', { name: 'Swap red offense and defense' }).click();
  await page.reload();
  await expect(page.locator('.team.red button.seat').first()).toContainText('Cat');
  await expect(page.locator('.team.red button.seat').nth(1)).toContainText('Ann Lee');

  await page.getByRole('button', { name: 'Start game' }).click();
  const goal = (team: string) => page.getByRole('button', { name: `Goal for ${team}` });
  await goal('red').click();
  await goal('red').click();
  await goal('red').click();
  await goal('blue').click();
  await page.getByRole('button', { name: 'Take a goal back from red' }).click();
  await expect(page.locator('.side.red .score')).toHaveText('2');

  // The phone locks, the page reloads: the game is still on.
  await page.reload();
  await expect(page.locator('.side.red .score')).toHaveText('2');
  await expect(page.locator('.side.blue .score')).toHaveText('1');
  await expect(page.locator('.clock')).toHaveText(/^\d+:\d\d$/);

  await page.getByRole('button', { name: 'Finish game' }).click();
  await expect(page.locator('.confirm')).toContainText('red 2 : 1 blue');
  await page.getByRole('button', { name: 'Save game' }).click();

  await expect(page).toHaveURL(/\/games\/\d+\?saved$/);
  await expect(page.getByText('Game saved.')).toBeVisible();
  await expect(page.locator('.team.red .score')).toHaveText('2');
  await expect(page.locator('.team.blue')).toContainText('Gus');
  await expect(page.getByText('Recorded by Ann')).toBeVisible();

  // Rematch: the same four are still seated, scores back to zero.
  await page.getByRole('link', { name: 'Play again' }).click();
  await expect(page.locator('.team.blue')).toContainText('Gus');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeEnabled();

  // Entering a result afterwards: no clock, straight to the score.
  await page.getByRole('button', { name: 'Enter a final score' }).click();
  await expect(page.locator('.clock')).toHaveText('Final score');
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Discard game' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});
