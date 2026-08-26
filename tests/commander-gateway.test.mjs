import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleWorld, handleCommanderRequest } from '../src/battlefield/index.js';

function createWorld() {
  return createBattleWorld({
    scenarioId: 'gateway-test',
    areas: [
      { id: 'west', name: '西侧', position: { x: 20, y: 50 }, neighbors: [{ id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', position: { x: 80, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方', location: 'west', strength: 100 },
      { id: 'enemy', side: 'enemy', name: '敌方', location: 'east', strength: 100 },
    ],
    deceptionActions: [
      {
        id: 'false-retreat',
        name: '制造退却假象',
        effect: 'alter_enemy_belief',
        targetSide: 'enemy',
        targetUnitId: 'player',
        reportedAreaId: 'west',
        delaySeconds: 0,
        freshnessSeconds: 20,
        cooldownSeconds: 10,
      },
    ],
  });
}

const sessionOptions = {
  mapConfig: { coordinateSystem: 'normalized-2d', bounds: { x: [0, 100], y: [0, 100] } },
};

test('gateway accepts player commands and returns safe event deltas', () => {
  const issued = handleCommanderRequest(createWorld(), {
    eventCursor: 0,
    command: { type: 'move', unitId: 'player', targetAreaId: 'east', rawText: '让我方主力向东侧机动' },
  }, { side: 'player', commandDelaySeconds: 0, sessionOptions });
  assert.equal(issued.accepted, true);
  assert.equal(issued.response.session.ownOrders[0].status, 'transmitting');
  assert.equal(issued.response.session.ownOrders[0].originAreaId, 'west');
  assert.deepEqual(issued.response.session.ownOrders[0].route, ['west', 'east']);
  assert.equal(issued.response.session.ownOrders[0].totalTravelSeconds, 1);
  assert.equal(issued.response.session.ownOrders[0].remainingTravelSeconds, 1);
  assert.equal(issued.response.session.ownOrders[0].rawText, '让我方主力向东侧机动');
  assert.equal(issued.response.events[0].type, 'order_issued');
  assert.equal(issued.response.events[0].payload.unitId, 'player');
  assert.equal(issued.response.events[0].payload.actualAreaId, undefined);

  const advanced = handleCommanderRequest(issued.world, {
    eventCursor: issued.response.nextEventCursor,
    command: { type: 'advance', seconds: 1 },
  }, { side: 'player', commandDelaySeconds: 0, sessionOptions });
  assert.equal(advanced.accepted, true);
  assert.equal(advanced.response.session.map.friendlyUnits[0].areaId, 'east');
  assert.equal(advanced.response.session.ownOrders[0].status, 'completed');
  assert.equal(advanced.response.session.ownOrders[0].remainingTravelSeconds, 0);
  assert.equal(advanced.response.events[0].type, 'order_delivered');
});

test('gateway refuses commands targeting the opposing side', () => {
  const result = handleCommanderRequest(createWorld(), {
    command: { type: 'move', unitId: 'enemy', targetAreaId: 'west' },
  }, { side: 'player', sessionOptions });
  assert.equal(result.accepted, false);
  assert.match(result.error, /本方部队/);
});

test('gateway keeps scouting truth inside the engine', () => {
  const result = handleCommanderRequest(createWorld(), {
    command: { type: 'scout' },
  }, {
    side: 'player',
    scout: {
      targetUnitId: 'enemy',
      reportedAreaId: 'west',
      actualAreaId: 'east',
      delaySeconds: 0,
      freshnessSeconds: 20,
      confidence: 'low',
      sourceType: '前出斥候',
      observation: '疑似敌情',
    },
    sessionOptions,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.response.session.ownObservations[0].status, 'in_transit');
  assert.equal(JSON.stringify(result.response).includes('actualAreaId'), false);
});

test('deception plants a false report and lets enemy AI act on its own belief', () => {
  const issued = handleCommanderRequest(createWorld(), {
    command: { type: 'deception', actionId: 'false-retreat' },
  }, { side: 'player', commandDelaySeconds: 0, sessionOptions });
  assert.equal(issued.accepted, true);
  assert.equal(issued.response.session.deceptionHistory[0].reportedAreaId, 'west');
  assert.equal(issued.response.events[0].type, 'deception_issued');
  assert.equal(JSON.stringify(issued.response).includes('actualAreaId'), false);

  const advanced = handleCommanderRequest(issued.world, {
    eventCursor: issued.response.nextEventCursor,
    command: { type: 'advance', seconds: 15 },
  }, { side: 'player', commandDelaySeconds: 0, sessionOptions });
  assert.equal(advanced.world.beliefs.enemy.sightings.player.areaId, 'west');
  assert.ok(advanced.world.orders.some((order) => order.unitId === 'enemy' && order.targetAreaId === 'west'));
});

test('deception respects an action cooldown', () => {
  const first = handleCommanderRequest(createWorld(), {
    command: { type: 'deception', actionId: 'false-retreat' },
  }, { side: 'player', sessionOptions });
  const second = handleCommanderRequest(first.world, {
    command: { type: 'deception', actionId: 'false-retreat' },
  }, { side: 'player', sessionOptions });
  assert.equal(second.accepted, false);
  assert.match(second.error, /冷却/);
});
