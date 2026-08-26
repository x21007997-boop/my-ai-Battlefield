import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_ORDER_TYPES, createBattleWorld, evaluateBattleOutcome, issueOrder, queueObservation, stepBattle } from '../src/battlefield/index.js';

test('ends a battle when data-driven victory conditions are met', () => {
  const world = createBattleWorld({
    scenarioId: 'resolution-test',
    areas: [
      { id: 'camp', neighbors: [{ id: 'ridge', travelSeconds: 1 }] },
      { id: 'ridge', neighbors: [{ id: 'camp', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', location: 'camp', strength: 100 },
      { id: 'enemy', side: 'enemy', location: 'ridge', strength: 100 },
    ],
    resolution: {
      victory: {
        id: 'take-ridge',
        result: 'victory',
        requiredUnitPositions: [{ unitId: 'player', areaId: 'ridge' }],
      },
    },
  });
  const issued = issueOrder(world, { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player', targetAreaId: 'ridge' });
  const ended = stepBattle(issued.world, 1);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.outcome.id, 'take-ridge');
  assert.ok(ended.eventLog.some((event) => event.type === 'battle_ended'));
  assert.deepEqual(stepBattle(ended, 10), ended);
});

test('ends a battle by time limit without exposing enemy truth', () => {
  const world = createBattleWorld({
    scenarioId: 'timeout-test',
    areas: [{ id: 'camp' }],
    units: [{ id: 'player', side: 'player', location: 'camp', strength: 100 }],
    resolution: { timeLimitSeconds: 2, timeout: { id: 'stalemate', result: 'strategic-stalemate' } },
  });
  const ended = stepBattle(world, 2);
  assert.equal(ended.outcome.result, 'strategic-stalemate');
  const event = ended.eventLog.find((item) => item.type === 'battle_ended');
  assert.equal(event.payload, undefined);
  assert.equal(event.actualAreaId, undefined);
});

test('victory may depend on commander belief rather than a direct enemy view', () => {
  const world = createBattleWorld({
    scenarioId: 'belief-resolution-test',
    areas: [{ id: 'camp' }],
    units: [
      { id: 'player', side: 'player', location: 'camp', strength: 100 },
      { id: 'relief', side: 'enemy', location: 'camp', strength: 100 },
    ],
    resolution: {
      victory: {
        id: 'hold-report',
        result: 'victory',
        requiredBeliefs: [{ side: 'player', targetUnitId: 'relief', areaId: 'camp' }],
      },
    },
  });
  const queued = queueObservation(world, { observerSide: 'player', targetUnitId: 'relief', reportedAreaId: 'camp', delaySeconds: 0 });
  const ended = stepBattle(queued.world, 1);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.outcome.id, 'hold-report');
});
