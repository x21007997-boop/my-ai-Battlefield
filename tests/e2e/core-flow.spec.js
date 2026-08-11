import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('hongguang-tutorial-complete', '1');
    localStorage.setItem('hongguang-preferences', JSON.stringify({ motion: 'reduced', scale: 1, skipOpening: false }));
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

test('completes a full monthly turn and records its consequences', async ({ page }) => {
  await page.goto('/');
  await page.locator('.scenario-card').first().getByRole('button', { name: '进入此局' }).click();
  await page.getByRole('button', { name: '跳过序章' }).click();
  const initialTurnLabel = await page.locator('.turn-label').innerText();
  const initialDisplayTurn = Number(initialTurnLabel.match(/第(\d+)回合/)[1]);

  await page.getByRole('button', { name: '调粮赈济' }).click();
  await expect(page.locator('.decision-readback')).toContainText('调运粮草');
  await page.getByRole('button', { name: '分析影响' }).click();
  await page.getByRole('button', { name: '确认执行' }).click();

  const resolution = page.getByRole('dialog', { name: /调运.*粮草/ });
  await expect(resolution).toBeVisible();
  await expect(resolution.locator('.resolution-aftereffect')).toContainText('赈粮后效');
  await resolution.getByRole('button', { name: '收入起居注，继续执政' }).click();
  await expect(page.locator('.turn-label')).toContainText(`第${initialDisplayTurn + 1}回合`);
  await expect(page.locator('.pending-consequences')).toContainText('赈粮后效');

  const autosave = await page.evaluate(() => JSON.parse(localStorage.getItem('hongguang-autosave')));
  expect(autosave.world.turn).toBe(initialDisplayTurn);
  expect(autosave.world.history).toHaveLength(1);
  expect(autosave.world.pendingEffects).toHaveLength(1);

  await page.getByRole('button', { name: '查看推演档案' }).click();
  await expect(page.getByRole('heading', { name: '弘光元年江南决策实录' })).toBeVisible();
  await expect(page.locator('.history-list')).toContainText('调运二十万石粮草');
});

test('loads the adviser council from the selected scenario package', async ({ page }) => {
  await page.goto('/');
  await page.locator('.scenario-card').nth(1).getByRole('button', { name: '进入此局' }).click();
  await expect(page.getByRole('heading', { name: '大兵压境，扬州已成江北孤城' })).toBeVisible();
  await page.getByRole('button', { name: '跳过序章' }).click();
  const council = page.locator('.council');
  await expect(council).toContainText('刘肇基');
  await expect(council).toContainText('扬州绅民');
  await expect(council).toContainText('坚守扬州');
  await expect(council).not.toContainText('户部尚书');
  await page.getByRole('button', { name: '召集会议' }).click();
  await expect(page.getByRole('heading', { name: '扬州守御会商' })).toBeVisible();
});
