import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('hongguang-tutorial-complete', '1');
  });
});

test('enters a scenario and interprets an editable edict', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '择一局，重写未定之史' })).toBeVisible();
  await page.locator('.scenario-card').first().getByRole('button', { name: '进入此局' }).click();
  await expect(page.getByRole('heading', { name: '北都既覆，江山只余半壁' })).toBeVisible();
  await page.getByRole('button', { name: '跳过序章' }).click();

  const edict = page.getByPlaceholder('下达你的诏令、政策或处置意见……');
  await edict.fill('着从南京调运二十万石粮草至淮安，沿途严查侵耗。');
  await expect(page.locator('.decision-readback')).toContainText('调运粮草 · 南京 → 淮安 · 20万');
  await page.getByRole('button', { name: '分析影响' }).click();
  await expect(page.locator('.analysis-bar')).toContainText('决策预演');
});

test('opens experience settings and persists preferences', async ({ page }) => {
  await page.goto('/');
  await page.locator('.scenario-card').first().getByRole('button', { name: '进入此局' }).click();
  await page.getByRole('button', { name: '跳过序章' }).click();
  await page.getByRole('button', { name: '体验设置' }).click();
  await expect(page.getByRole('heading', { name: '依你的习惯入局' })).toBeVisible();
  await page.getByRole('button', { name: '减少动态' }).click();
  await page.getByText('新局跳过序章').click();
  await page.getByRole('button', { name: '保存并返回' }).click();

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduced');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hongguang-preferences')).skipOpening)).toBe(true);
});

test('opens help with keyboard shortcuts without hijacking edict input', async ({ page }) => {
  await page.goto('/');
  await page.locator('.scenario-card').first().getByRole('button', { name: '进入此局' }).click();
  await page.getByRole('button', { name: '跳过序章' }).click();
  await page.keyboard.press('h');
  await expect(page.getByRole('heading', { name: '这一月该如何裁决' })).toBeVisible();
  await page.keyboard.press('Escape');

  const edict = page.getByPlaceholder('下达你的诏令、政策或处置意见……');
  await edict.fill('h');
  await expect(page.getByRole('heading', { name: '这一月该如何裁决' })).toBeHidden();
  await expect(edict).toHaveValue('h');
});
