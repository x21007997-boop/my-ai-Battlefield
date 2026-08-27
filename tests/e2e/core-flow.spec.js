import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('hongguang-tutorial-complete', '1');
    localStorage.setItem('hongguang-preferences', JSON.stringify({ motion: 'reduced', scale: 1, skipOpening: false }));
  });
});

test('lists Changping as a formal playable battle level', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const battleCard = page.locator('.battle-game-card');
  await expect(battleCard).toContainText('正式战役关卡');
  await expect(battleCard.getByRole('link', { name: '进入战役' })).toHaveAttribute('href', '/?battle=changping');
});

test('enters a scenario and interprets an editable edict', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '择一局，重写未定之史' })).toBeVisible();
  await page.locator('.scenario-card:not(.battle-game-card)').first().getByRole('button', { name: '进入此局' }).click();
  await expect(page.getByRole('heading', { name: '北都既覆，江山只余半壁' })).toBeVisible();
  await page.getByRole('button', { name: '跳过序章' }).click();

  const edict = page.getByPlaceholder('下达你的诏令、政策或处置意见……');
  await edict.fill('着从南京调运二十万石粮草至淮安，沿途严查侵耗。');
  await expect(page.locator('.decision-readback')).toContainText('调运粮草 · 南京 → 淮安 · 20万');
  await page.getByRole('button', { name: '分析影响' }).click();
  await expect(page.locator('.analysis-bar')).toContainText('决策预演');
});

test('opens experience settings and persists preferences', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.scenario-card:not(.battle-game-card)').first().getByRole('button', { name: '进入此局' }).click();
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.scenario-card:not(.battle-game-card)').first().getByRole('button', { name: '进入此局' }).click();
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.scenario-card:not(.battle-game-card)').first().getByRole('button', { name: '进入此局' }).click();
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.scenario-card:not(.battle-game-card)').nth(1).getByRole('button', { name: '进入此局' }).click();
  await expect(page.getByRole('heading', { name: '大兵压境，扬州已成江北孤城' })).toBeVisible();
  await page.getByRole('button', { name: '跳过序章' }).click();
  const council = page.locator('.council');
  await expect(council).toContainText('刘肇基');
  await expect(council).toContainText('扬州绅民');
  await expect(council).toContainText('坚守扬州');
  await expect(council).not.toContainText('户部尚书');
  await expect(page.locator('.faction-balance')).toContainText('援扬诸军');
  await expect(page.locator('.faction-balance')).toContainText('南京饷源');
  await expect(page.locator('.frontline')).toContainText('清军逼近扬州');
  await expect(page.locator('.causal-line')).toContainText('援军未集');
  await expect(page.locator('.map-panel > img')).toHaveAttribute('src', '/assets/yangzhou-siege-map.png');
  await page.getByRole('button', { name: '召集会议' }).click();
  await expect(page.getByRole('heading', { name: '扬州守御会商' })).toBeVisible();
});

test('connects the real-time battlefield core to the validation level', async ({ page }) => {
  await page.goto('/?battle=fixture', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '战场内核验证关' })).toBeVisible();
  await expect(page.getByText('内部验证内容')).toBeVisible();
  await expect(page.locator('.area-marker-symbol')).toHaveCount(3);
  await expect(page.locator('.legend-landmark')).toBeVisible();

  await page.getByRole('button', { name: /谷地通道/ }).last().click();
  await expect(page.locator('.order-row')).toContainText('传递中');
  await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await expect(page.locator('.order-row')).toContainText('执行中');

  await page.getByRole('button', { name: /派出侦查/ }).click();
  await expect(page.locator('.battle-notice')).toContainText('5 秒');
  for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await expect(page.locator('.report-list')).toContainText('谷地通道');
  await expect(page.locator('.battle-event-list')).toContainText('情报抵达');
  await expect(page.locator('.presence-sighting')).toHaveCount(1);
  await expect(page.locator('.battle-event-list')).not.toContainText('交战：');
});

test('opens the formal Changping battle level', async ({ page }) => {
  await page.goto('/?battle=changping', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '长平决战前 · 指挥沙盘' })).toBeVisible();
  await expect(page.getByText('关卡参数与史实分离')).toBeVisible();
  await expect(page.getByRole('heading', { name: '西营—长平西口—丹水河谷—赵军壁垒' })).toBeVisible();
  await expect(page.getByText('战力指数', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.area-marker-symbol')).toHaveCount(6);
  await expect(page.locator('.legend-landmark')).toBeVisible();
  await page.getByRole('button', { name: /丹水河谷/ }).last().click();
  await expect(page.locator('.order-row')).toContainText('传递中');
  await expect(page.locator('.battle-notice')).toContainText('命令已接收');
  await expect(page.locator('.map-faction-legend')).toContainText('秦军·已知');
  await expect(page.locator('.map-faction-legend')).toContainText('赵军·疑似');

  const deceptionButton = page.getByRole('button', { name: /散布秦军惧怕赵括的假情报/ });
  await expect(deceptionButton).toBeVisible();
  await deceptionButton.click();
  await expect(page.locator('.battle-notice')).toContainText('计策已接收');
  await expect(page.locator('.deception-history')).toContainText('准备中');
  for (let i = 0; i < 9; i += 1) await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await expect(page.locator('.deception-history')).toContainText('已送达敌方认知');
});

test('routes a free-form order through a named remote deputy', async ({ page }) => {
  await page.goto('/?battle=changping', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '长平决战前 · 指挥沙盘' })).toBeVisible();

  await page.getByRole('combobox', { name: '接收军官' }).selectOption('wang-he');
  await expect(page.locator('.commander-row').filter({ hasText: '王龁' })).toContainText('远程');
  await expect(page.locator('.command-delivery-hint')).toContainText('传令兵在途');
  await expect(page.getByRole('combobox', { name: '当前部队' })).toHaveValue('qin-detachment');

  await page.getByRole('textbox', { name: '自由军令' }).fill('让王龁率秦军机动部队向丹水河谷推进');
  await page.getByRole('button', { name: '传达' }).click();
  await expect(page.locator('.battle-notice')).toContainText('AI识别为：机动');
  await expect(page.locator('.order-row')).toContainText('传递中');
  await expect(page.locator('.battle-map-surface')).toContainText('传递中');

  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: '手动推进 1 秒' }).click();
  await expect(page.locator('.order-row')).toContainText('执行中');
  await expect(page.locator('.battle-event-list')).toContainText('传令抵达：王龁');
  await expect(page.locator('.battle-event-list')).toContainText('王龁接受执行');
});
