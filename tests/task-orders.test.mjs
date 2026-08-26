import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_TASK_ORDER_TYPES, consumeLogistics, createBattleWorld, issueOrder, stepBattle } from '../src/battlefield/index.js';

function createWorld({ enemyLocation = 'east' } = {}) {
  return createBattleWorld({
    scenarioId: 'task-orders-test',
    areas: [
      { id: 'west', name: '西侧', position: { x: 20, y: 50 }, neighbors: [{ id: 'valley', travelSeconds: 2 }] },
      { id: 'valley', name: '谷地', position: { x: 50, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 2 }, { id: 'east', travelSeconds: 2 }] },
      { id: 'east', name: '东侧', position: { x: 80, y: 50 }, neighbors: [{ id: 'valley', travelSeconds: 2 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方任务部队', location: 'west', strength: 1000, supplyDays: 5 },
      { id: 'enemy', side: 'enemy', name: '敌方部队', location: enemyLocation, strength: 1000, supplyDays: 5 },
    ],
  });
}

function completeTask(type, targetAreaId = 'valley', seconds = 3) {
  const issued = issueOrder(createWorld(), { type, unitId: 'player', targetAreaId }, { delaySeconds: 0 });
  assert.equal(issued.error, null);
  return stepBattle(issued.world, seconds);
}

test('all six task commands use the shared delayed order contract', () => {
  for (const type of BATTLE_TASK_ORDER_TYPES) {
    const world = completeTask(type);
    const order = world.orders[0];
    assert.equal(order.type, type);
    assert.equal(order.taskType, type);
    assert.equal(order.status, 'completed');
    assert.equal(order.taskStatus, 'active');
    assert.equal(world.units.player.location, 'valley');
    assert.equal(world.units.player.posture, type);
    assert.ok(world.eventLog.some((event) => event.type === 'task_effect_applied' && event.taskType === type));
  }
});

test('blockade prevents an opposing unit from entering the controlled area', () => {
  const blockade = completeTask('blockade');
  const enemyOrder = issueOrder(blockade, { type: 'move', unitId: 'enemy', targetAreaId: 'valley' }, { delaySeconds: 0 });
  const blocked = stepBattle(enemyOrder.world, 1);
  assert.equal(blocked.orders[1].status, 'blocked');
  assert.equal(blocked.units.enemy.location, 'east');
  assert.ok(blocked.eventLog.some((event) => event.type === 'order_blocked' && event.reason === 'opposing_blockade'));
});

test('decoy creates a delayed signal and supply interdiction adds logistics pressure', () => {
  const decoy = completeTask('decoy');
  assert.ok(decoy.observations.some((observation) => observation.sourceType === 'decoy-signal' && observation.status === 'in_transit'));

  const interdiction = completeTask('interdict_supply', 'east', 4);
  assert.equal(interdiction.supplyInterdictions.length, 1);
  const before = interdiction.units.enemy.supplyDays;
  const after = consumeLogistics(interdiction, { intervalSeconds: 1 });
  assert.equal(after.units.enemy.supplyDays, before - 2);
  assert.ok(after.eventLog.some((event) => event.type === 'supply_interdicted'));
});
