import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, createInitialWorld, parseDecision, previewDecision, resolveTurn } from '../src/simulation.js';
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
