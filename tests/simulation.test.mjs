import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, createInitialWorld, investigateReport, parseDecision, previewDecision, resolveTurn } from '../src/simulation.js';
import { currentOutcome, reportsForWorld } from '../src/scenario.js';

test('parses the three supported decision types', () => {
  const world = createInitialWorld();
  assert.equal(parseDecision('调拨二十万石粮草赈济淮安', world).action.type, ACTION_TYPES.TRANSPORT_GRAIN);
  assert.equal(parseDecision('调动五万兵力增援扬州', world).action.type, ACTION_TYPES.DEPLOY_ARMY);
  assert.equal(parseDecision('派遣史可法前往淮安查办', world).action.type, ACTION_TYPES.APPOINT_OFFICIAL);
  assert.deepEqual(
    (({ source, target }) => ({ source, target }))(parseDecision('从南京调动五万兵力增援扬州', world).action),
    { source: '南京', target: '扬州' },
  );
});

test('rejects unsupported or empty decisions', () => {
  assert.equal(previewDecision(createInitialWorld(), '').valid, false);
  assert.equal(previewDecision(createInitialWorld(), '修建一座宫殿').valid, false);
});

test('same snapshot and decision resolve identically', () => {
  const world = createInitialWorld();
  const command = '调拨二十万石粮草赈济淮安';
  assert.deepEqual(resolveTurn(world, command), resolveTurn(world, command));
});

test('decisions update adviser relations and retain delayed consequences', () => {
  const result = resolveTurn(createInitialWorld(), '从南京调拨二十万石粮草赈济淮安');
  assert.deepEqual(result.record.relationEffects, { shi: 5, hubu: -2, local: 2 });
  assert.equal(result.world.adviserRelations.shi, 73);
  assert.equal(result.world.pendingEffects.at(-1).label, '淮安赈粮后效');
});

test('high trust unlocks an active adviser intervention', () => {
  const world = createInitialWorld();
  world.adviserRelations.shi = 78;
  const result = resolveTurn(world, '从南京调动五万兵力增援扬州');
  assert.equal(result.record.adviserReaction.title, '史可法补陈方略');
  assert.equal(result.record.adviserReaction.tone, 'support');
  assert.ok(result.record.effects.defense >= 2);
});

test('low trust can obstruct execution', () => {
  const world = createInitialWorld();
  world.adviserRelations.hubu = 34;
  const result = resolveTurn(world, '从南京调拨二十万石粮草赈济淮安');
  assert.equal(result.record.adviserReaction.title, '户部封驳诏令');
  assert.equal(result.record.adviserReaction.tone, 'obstruction');
  assert.ok(result.record.effects.treasury <= -14);
});

test('decisions move faction influence in competing directions', () => {
  const result = resolveTurn(createInitialWorld(), '从南京调拨二十万石粮草赈济淮安');
  assert.deepEqual(result.record.factionEffects, { jiangbei: 4, finance: -4, gentry: 3 });
  assert.deepEqual(result.world.factionInfluence, { jiangbei: 62, finance: 52, gentry: 55 });
});

test('dominant factions create political shift events', () => {
  const world = createInitialWorld();
  world.factionInfluence.jiangbei = 72;
  const result = resolveTurn(world, '从南京调动五万兵力增援扬州');
  assert.equal(result.record.factionShift.title, '江北军政声势日隆');
  assert.ok(result.record.events.some((event) => event.type === 'faction_shift'));
});

test('investigations consume intelligence points and persist a verdict', () => {
  const world = createInitialWorld();
  const report = reportsForWorld(world)[0];
  const checked = investigateReport(world, report);
  assert.equal(checked.world.intelligence.points, 2);
  assert.equal(checked.result.verified, true);
  assert.equal(checked.world.intelligence.reports[report.region].reportTitle, report.title);
  const reused = investigateReport(checked.world, report);
  assert.equal(reused.reused, true);
  assert.equal(reused.world.intelligence.points, 2);
});

test('verified target intelligence improves resolution odds', () => {
  const world = createInitialWorld();
  world.intelligence.reports.淮安 = { verified: true, reportTitle: '核查结果' };
  const result = resolveTurn(world, '从南京调拨二十万石粮草赈济淮安');
  assert.equal(result.record.intelligenceBonus, 0.15);
});

test('three turns form an auditable history with delayed effects', () => {
  let world = createInitialWorld();
  world = resolveTurn(world, '调拨二十万石粮草赈济淮安').world;
  world = resolveTurn(world, '调动五万兵力增援扬州').world;
  world = resolveTurn(world, '派遣史可法前往淮安查办').world;
  assert.equal(world.turn, 6);
  assert.equal(world.history.length, 3);
  assert.ok(world.history[1].delayedResolved.includes('淮安赈粮后效'));
  assert.ok(world.metrics.defense > 61);
  assert.equal(currentOutcome(world)?.outcome, '江北暂安');
});

test('ignoring the grain crisis triggers the Huaian unrest branch and a new report', () => {
  const result = resolveTurn(createInitialWorld(), '调动五万兵力增援扬州').world;
  assert.ok(result.flags.includes('huaian_unrest_escalated'));
  assert.equal(reportsForWorld(result)[0].title, '饥民聚集冲仓');
  assert.equal(result.previousEffects.support, -6);
});

test('weak defense on the second month triggers desertion', () => {
  let world = resolveTurn(createInitialWorld(), '调拨二十万石粮草赈济淮安').world;
  world.metrics.defense = 60;
  world = resolveTurn(world, '派遣史可法前往淮安查办').world;
  assert.ok(world.flags.includes('yangzhou_desertion'));
  assert.equal(world.history.at(-1).events.at(-1).title, '江防营兵夜逃');
});

test('chapter outcome falls back to fractured Jiangbei when both realm indicators are weak', () => {
  let world = createInitialWorld();
  world = resolveTurn(world, '调动五万兵力增援扬州').world;
  world = resolveTurn(world, '派遣史可法前往淮安查办').world;
  world.metrics.defense = 50;
  world.metrics.support = 40;
  world = resolveTurn(world, '调拨三万石粮草赈济淮安').world;
  assert.equal(currentOutcome(world)?.outcome, '江北离心');
});

test('a second registered scenario runs without changing the rule engine', () => {
  let world = createInitialWorld('hongguang-yangzhou-1645');
  assert.equal(world.turn, 0);
  assert.equal(world.metrics.treasury, 610);
  world = resolveTurn(world, '调拨二十万石粮草赈济扬州').world;
  world = resolveTurn(world, '调动五万兵力增援扬州').world;
  world = resolveTurn(world, '派遣史可法前往扬州查办').world;
  assert.equal(world.turn, 3);
  assert.ok(['军民同守', '孤军守城', '城中离心'].includes(currentOutcome(world)?.outcome));
  assert.ok(world.flags.includes('yangzhou_grain_stocked'));
});
