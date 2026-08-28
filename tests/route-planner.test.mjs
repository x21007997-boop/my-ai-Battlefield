import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCommanderMapModel, buildCommanderRouteOptions, createBattleWorld, handleCommanderRequest, issueOrder, queueObservation, stepBattle } from '../src/battlefield/index.js';

function edge(id, distanceLi, overrides = {}) {
  return { id, distanceLi, distanceUncertainty: 0.25, distanceStatus: 'scenario_assumption', geometryStatus: 'scenario_assumption', grade: 'gentle', surface: 'packed-earth', capacity: 'formation', concealment: 'medium', baggageAccess: 'full', ...overrides };
}

function world() {
  return createBattleWorld({
    calendar: { schemaVersion: 1, system: 'scenario-relative', eraLabel: '战国纪年', start: { year: -260, month: 8, day: 1, secondOfDay: 36000 } },
    areas: [
      { id: 'camp', name: '西营', position: { x: 10, y: 50 }, neighbors: [edge('valley', 8), edge('ridge', 10, { grade: 'steep', concealment: 'high', baggageAccess: 'none' })] },
      { id: 'valley', name: '谷地', position: { x: 40, y: 65 }, neighbors: [edge('camp', 8), edge('target', 8)] },
      { id: 'ridge', name: '山脊', position: { x: 45, y: 25 }, neighbors: [edge('camp', 10), edge('target', 7, { grade: 'steep', concealment: 'high', baggageAccess: 'none' })] },
      { id: 'target', name: '关口', position: { x: 80, y: 45 }, neighbors: [edge('valley', 8), edge('ridge', 7, { grade: 'steep', concealment: 'high', baggageAccess: 'none' })] },
    ],
    units: [
      { id: 'army', side: 'player', name: '秦军主力', unitType: 'field-army', location: 'camp', strength: 100, fatigue: 20 },
      { id: 'enemy', side: 'enemy', name: '赵军', unitType: 'field-army', location: 'target', strength: 100 },
    ],
  });
}

test('route planner compares commander-safe distance, arrival, supply and exposure estimates', () => {
  const options = buildCommanderRouteOptions(world(), { unitId: 'army', targetAreaId: 'target' });
  assert.equal(options.length, 2);
  assert.equal(options[0].recommended, true);
  assert.match(options[0].distanceEstimate.label, /^约.+里$/);
  assert.match(options[0].arrivalEstimate.label, /前后|之间/);
  assert.ok(['low', 'medium', 'high'].includes(options[0].supplyPressure.level));
  assert.ok(['low', 'medium', 'high'].includes(options[0].exposureRisk.level));
  assert.equal(JSON.stringify(options).includes('travelSeconds'), false);
  assert.equal(JSON.stringify(options).includes('mobilityFactors'), false);
});

test('commander map distinguishes planned, confirmed, presumed and suspected routes', () => {
  let current = issueOrder(world(), { type: 'move', unitId: 'army', targetAreaId: 'target' }, { delaySeconds: 2 }).world;
  let map = buildCommanderMapModel(current, { side: 'player' });
  assert.equal(map.routeLayers.friendly[0].kind, 'planned-friendly');
  current = stepBattle(current, 2);
  map = buildCommanderMapModel(current, { side: 'player' });
  assert.equal(map.routeLayers.friendly[0].kind, 'confirmed-friendly');
  current.units.army.communication = 'lost';
  map = buildCommanderMapModel(current, { side: 'player' });
  assert.equal(map.routeLayers.friendly[0].kind, 'presumed-friendly');

  current = queueObservation(current, { observerSide: 'player', targetUnitId: 'enemy', reportedAreaId: 'ridge', delaySeconds: 0 }).world;
  current = stepBattle(current, 1);
  current = queueObservation(current, { observerSide: 'player', targetUnitId: 'enemy', reportedAreaId: 'target', delaySeconds: 0 }).world;
  current = stepBattle(current, 1);
  map = buildCommanderMapModel(current, { side: 'player' });
  assert.equal(map.routeLayers.suspectedEnemy[0].kind, 'suspected-enemy');
  assert.deepEqual(map.routeLayers.suspectedEnemy[0].points.length, 2);
  assert.equal(JSON.stringify(map.routeLayers).includes('actualAreaId'), false);
});

test('gateway exposes route planning without mutating battlefield state', () => {
  const initial = world();
  const result = handleCommanderRequest(initial, { command: { type: 'plan_routes', unitId: 'army', targetAreaId: 'target' } }, { side: 'player' });
  assert.equal(result.accepted, true);
  assert.equal(result.result.options.length, 2);
  assert.deepEqual(result.world, initial);
  assert.equal(result.world.orders.length, 0);
});
