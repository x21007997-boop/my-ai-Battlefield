import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBattleWorld,
  dispatchReconnaissance,
  issueDeception,
  stepBattle,
} from '../src/battlefield/index.js';

function createWorld({ seed = 7, scoutTeams = 1, intelligencePoints = 2, deceptionAssets = 2 } = {}) {
  return createBattleWorld({
    scenarioId: 'strategy-costs-test',
    seed,
    areas: [
      { id: 'west', name: '西侧', position: { x: 20, y: 50 }, neighbors: [{ id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', position: { x: 80, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方斥候', location: 'west', strength: 100 },
      { id: 'enemy', side: 'enemy', name: '敌军', location: 'east', strength: 100 },
    ],
    sides: [{ id: 'player', name: '我方' }, { id: 'enemy', name: '敌方' }],
    resources: {
      player: { scoutTeams, intelligencePoints, deceptionAssets },
      enemy: { scoutTeams: 1, intelligencePoints: 1, deceptionAssets: 1 },
    },
    deceptionActions: [
      {
        id: 'false-route',
        name: '制造错误行军方向',
        effect: 'alter_enemy_belief',
        targetSide: 'enemy',
        targetUnitId: 'player',
        reportedAreaId: 'east',
        delaySeconds: 1,
        preparationSeconds: 1,
        freshnessSeconds: 20,
        confidence: 'medium',
        cooldownSeconds: 0,
        cost: { deceptionAssets: 1 },
        exposureProbability: 0,
      },
      {
        id: 'exposed-route',
        name: '高风险佯动',
        effect: 'alter_enemy_belief',
        targetSide: 'enemy',
        targetUnitId: 'player',
        reportedAreaId: 'east',
        delaySeconds: 1,
        preparationSeconds: 1,
        freshnessSeconds: 20,
        confidence: 'medium',
        cooldownSeconds: 0,
        cost: { deceptionAssets: 1 },
        exposureProbability: 1,
        failureReliabilityPenalty: 0.2,
      },
    ],
  });
}

test('reconnaissance spends resources and exposes its preparation window', () => {
  const issued = dispatchReconnaissance(createWorld(), {
    observerSide: 'player',
    targetUnitId: 'enemy',
    reportedAreaId: 'west',
    actualAreaId: 'east',
    preparationSeconds: 2,
    delaySeconds: 2,
    freshnessSeconds: 20,
    cost: { scoutTeams: 1, intelligencePoints: 1 },
    exposureProbability: 0,
    sourceType: '前出斥候',
  });
  assert.equal(issued.error, null);
  assert.equal(issued.observation, null);
  assert.equal(issued.action.status, 'preparing');
  assert.deepEqual(issued.world.resources.player, { scoutTeams: 0, intelligencePoints: 1, deceptionAssets: 2 });

  const prepared = stepBattle(issued.world, 2);
  assert.equal(prepared.strategy.actions[0].status, 'in_transit');
  assert.equal(prepared.observations[0].status, 'in_transit');
  assert.equal(prepared.observations[0].arrivesAt, 4);

  const delivered = stepBattle(prepared, 2);
  assert.equal(delivered.strategy.actions[0].status, 'delivered');
  assert.equal(delivered.beliefs.player.sightings.enemy.areaId, 'west');
});

test('resource shortages reject reconnaissance without mutating the ledger', () => {
  const world = createWorld({ scoutTeams: 0 });
  const result = dispatchReconnaissance(world, {
    observerSide: 'player',
    targetUnitId: 'enemy',
    reportedAreaId: 'west',
    cost: { scoutTeams: 1 },
  });
  assert.equal(result.errorCode, 'RESOURCE_INSUFFICIENT');
  assert.equal(result.world.resources.player.scoutTeams, 0);
  assert.equal(result.world.strategy.actions.length, 0);
});

test('exposed deception reduces future strategy reliability and never enters enemy belief', () => {
  const issued = issueDeception(createWorld(), { side: 'player', actionId: 'exposed-route' });
  assert.equal(issued.error, null);
  assert.equal(issued.deception.status, 'preparing');
  const resolved = stepBattle(issued.world, 1);
  assert.equal(resolved.deception.history[0].status, 'exposed');
  assert.equal(resolved.strategy.reliabilityBySide.player, 0.8);
  assert.equal(resolved.observations.length, 0);
  assert.equal(resolved.beliefs.enemy.sightings.player, undefined);
  assert.ok(resolved.eventLog.some((event) => event.type === 'deception_exposed'));
});

test('prepared deception enters the delayed report chain only after resource payment', () => {
  const issued = issueDeception(createWorld(), { side: 'player', actionId: 'false-route' });
  assert.equal(issued.error, null);
  assert.equal(issued.world.resources.player.deceptionAssets, 1);
  assert.equal(issued.world.observations.length, 0);
  const dispatched = stepBattle(issued.world, 1);
  assert.equal(dispatched.deception.history[0].status, 'queued');
  assert.equal(dispatched.observations[0].status, 'in_transit');
  const delivered = stepBattle(dispatched, 1);
  assert.equal(delivered.beliefs.enemy.sightings.player.areaId, 'east');
});
