import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommanderSessionSnapshot, createBattleWorld, issueOrder, queueObservation, stepBattle } from '../src/battlefield/index.js';

function createWorld() {
  return createBattleWorld({
    scenarioId: 'session-test',
    areas: [
      { id: 'west', name: '西侧', position: { x: 20, y: 50 }, neighbors: [{ id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', position: { x: 80, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方', location: 'west', strength: 100 },
      { id: 'enemy', side: 'enemy', name: '敌方', location: 'east', strength: 100 },
    ],
  });
}

test('commander session serializes a single safe event shape', () => {
  let world = createWorld();
  world = issueOrder(world, { type: 'move', unitId: 'player', targetAreaId: 'east' }, { delaySeconds: 0 }).world;
  world = queueObservation(world, {
    observerSide: 'player',
    targetUnitId: 'enemy',
    reportedAreaId: 'west',
    actualAreaId: 'east',
    delaySeconds: 1,
  }).world;
  world = stepBattle(world, 1);
  const session = buildCommanderSessionSnapshot(world, { side: 'player' });
  assert.equal(session.schemaVersion, 1);
  assert.equal(session.map.disclosure.rawEnemyUnitsIncluded, false);
  assert.equal(session.map.friendlyUnits[0].areaId, 'east');
  assert.equal(session.ownObservations[0].uncertainty.level, 'medium');
  assert.equal(session.ownObservations[0].actualAreaId, undefined);
  assert.equal(session.eventLog.every((event) => event.schemaVersion === 1 && event.payload !== undefined), true);
  assert.equal(session.eventLog.some((event) => event.payload.actualAreaId !== undefined), false);
  assert.equal(session.eventLog.some((event) => event.type === 'combat_exchange'), false);
});

test('commander route projection exposes approximate ranges instead of exact travel truth', () => {
  let world = createBattleWorld({
    scenarioId: 'estimated-route',
    calendar: {
      schemaVersion: 1,
      system: 'scenario-relative',
      eraLabel: '战国纪年',
      start: { year: -260, month: 8, day: 1, secondOfDay: 64800 },
      sunriseSecond: 21600,
      sunsetSecond: 64800,
    },
    areas: [
      { id: 'west', name: '西营', position: { x: 20, y: 50 }, neighbors: [{ id: 'east', travelSeconds: 999, distanceLi: 14, distanceUncertainty: 0.3, distanceStatus: 'scenario_assumption', grade: 'rolling', surface: 'packed-earth', capacity: 'formation', baggageAccess: 'limited' }] },
      { id: 'east', name: '东岭', position: { x: 80, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 999, distanceLi: 14, distanceUncertainty: 0.3, distanceStatus: 'scenario_assumption', grade: 'rolling', surface: 'packed-earth', capacity: 'formation', baggageAccess: 'limited' }] },
    ],
    units: [{ id: 'player', side: 'player', name: '秦军', unitType: 'field-army', location: 'west', strength: 100, fatigue: 20 }],
  });
  world = issueOrder(world, { type: 'move', unitId: 'player', targetAreaId: 'east' }, { delaySeconds: 80 }).world;
  const session = buildCommanderSessionSnapshot(world, { side: 'player' });
  const projectedOrder = session.ownOrders[0];
  const projectedRoute = session.map.routes[0];
  assert.match(projectedOrder.distanceEstimate.label, /^约.+里$/);
  assert.match(projectedOrder.movementEstimate.label, /前后|之间/);
  assert.equal(projectedOrder.movementEstimate.targetSimTime, undefined);
  assert.equal(projectedOrder.remainingTravelSeconds, undefined);
  assert.equal(projectedOrder.routeSegments[0].travelSeconds, undefined);
  assert.equal(projectedOrder.routeSegments[0].mobilityFactors, undefined);
  assert.equal(projectedRoute.distanceLi, undefined);
  assert.equal(projectedRoute.travelSeconds, undefined);
  assert.match(projectedRoute.distanceEstimate.label, /^约.+里$/);
});
