import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_ORDER_TYPES, buildCommanderMapModel, createBattleWorld, issueOrder, queueObservation, stepBattle, viewBelief } from '../src/battlefield/index.js';

function createFixture() {
  return createBattleWorld({
    scenarioId: 'battle-test',
    seed: 20260825,
    areas: [
      { id: 'north', name: '北口', position: { x: 25, y: 30 }, neighbors: [{ id: 'valley', travelSeconds: 3 }] },
      { id: 'valley', name: '谷地', position: { x: 52, y: 55 }, neighbors: [{ id: 'north', travelSeconds: 3 }, { id: 'ridge', travelSeconds: 4 }] },
      { id: 'ridge', name: '东岭', position: { x: 78, y: 28 }, neighbors: [{ id: 'valley', travelSeconds: 4 }] },
    ],
    units: [
      { id: 'player-wing', side: 'player', name: '我方左翼', location: 'north', strength: 1000, morale: 70, supplyDays: 5 },
      { id: 'enemy-main', side: 'enemy', name: '敌军主力', location: 'ridge', strength: 1200, morale: 65, supplyDays: 4 },
    ],
  });
}

function createTerrainFixture() {
  return createBattleWorld({
    scenarioId: 'terrain-test',
    terrainFeatures: [{
      id: 'test-river',
      type: 'river',
      name: '试验河流',
      points: [{ x: 20, y: 40 }, { x: 80, y: 40 }],
      status: 'scenario_assumption',
    }],
    areas: [
      {
        id: 'west',
        name: '西岸',
        position: { x: 20, y: 40 },
        neighbors: [{
          id: 'east',
          travelSeconds: 4,
          terrainTransitions: [{
            featureId: 'test-river',
            terrainType: 'river',
            transitionType: 'river-crossing',
            label: '试验河流渡河',
            startProgress: 0.25,
            endProgress: 0.5,
            method: 'ford',
            effects: {
              fatiguePerSecond: 1.5,
              supplyDaysPerSecond: 0.1,
              readinessLossPerSecond: 0.02,
            },
          }],
        }],
      },
      { id: 'east', name: '东岸', position: { x: 80, y: 40 }, neighbors: [{ id: 'west', travelSeconds: 4 }] },
    ],
    units: [{ id: 'player', side: 'player', name: '我方部队', location: 'west', strength: 100, supplyDays: 5 }],
  });
}

test('creates a serializable battlefield with separate belief states', () => {
  const world = createFixture();
  assert.equal(world.simTime, 0);
  assert.deepEqual(world.beliefs.player.knownOwnUnitIds, ['player-wing']);
  assert.deepEqual(world.beliefs.enemy.knownOwnUnitIds, ['enemy-main']);
  assert.doesNotThrow(() => JSON.stringify(world));
});

test('orders transmit before a unit begins moving', () => {
  const issued = issueOrder(createFixture(), { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player-wing', targetAreaId: 'valley' }, { delaySeconds: 2 });
  assert.equal(issued.error, null);
  assert.equal(issued.world.units['player-wing'].location, 'north');
  assert.equal(issued.order.status, 'transmitting');

  const afterOneSecond = stepBattle(issued.world, 1);
  assert.equal(afterOneSecond.simTime, 1);
  assert.equal(afterOneSecond.orders[0].status, 'transmitting');
  assert.equal(afterOneSecond.units['player-wing'].location, 'north');

  const afterTwoSeconds = stepBattle(afterOneSecond, 1);
  assert.equal(afterTwoSeconds.orders[0].status, 'executing');
  assert.equal(afterTwoSeconds.units['player-wing'].location, 'north');

  const arrived = stepBattle(afterTwoSeconds, 3);
  assert.equal(arrived.units['player-wing'].location, 'valley');
  assert.equal(arrived.orders[0].status, 'completed');
  assert.ok(arrived.eventLog.some((event) => event.type === 'order_delivered'));
  assert.ok(arrived.eventLog.some((event) => event.type === 'unit_arrived'));
});

test('movement enters and exits modeled terrain instead of teleporting between areas', () => {
  const issued = issueOrder(createTerrainFixture(), { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player', targetAreaId: 'east' }, { delaySeconds: 0 });
  assert.equal(issued.error, null);
  assert.equal(issued.order.terrainTransitions[0].status, 'upcoming');

  const entered = stepBattle(issued.world, 1);
  assert.deepEqual(entered.orders[0].currentTerrain, {
    featureId: 'test-river',
    terrainType: 'river',
    label: '试验河流渡河',
    method: 'ford',
  });
  assert.ok(entered.eventLog.some((event) => event.type === 'unit_entered_terrain' && event.terrainType === 'river'));
  assert.equal(entered.units.player.location, 'west');
  assert.equal(entered.units.player.fatigue, 0);
  assert.equal(entered.units.player.supplyDays, 5);

  const crossed = stepBattle(entered, 1);
  assert.equal(crossed.orders[0].currentTerrain, null);
  assert.equal(crossed.orders[0].lastTerrainTransition.label, '试验河流渡河');
  assert.ok(crossed.eventLog.some((event) => event.type === 'unit_exited_terrain'));
  assert.equal(crossed.orders[0].movementProgress, 0.5);
  assert.equal(crossed.units.player.fatigue, 1.5);
  assert.equal(crossed.orders[0].lastTerrainTransition.effectsApplied.fatigue, 1.5);
});

test('commander map projects a moving friendly unit along its route', () => {
  const issued = issueOrder(createTerrainFixture(), { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player', targetAreaId: 'east' }, { delaySeconds: 0 });
  const moving = stepBattle(issued.world, 1);
  const projected = buildCommanderMapModel(moving, { mapMarkers: [] });
  assert.deepEqual(projected.friendlyUnits[0].position, { x: 35, y: 40 });
  assert.equal(projected.friendlyUnits[0].movement.progress, 0.25);
  assert.equal(projected.friendlyUnits[0].movement.currentTerrain.terrainType, 'river');
  assert.equal(projected.friendlyUnits[0].movement.currentTerrain.label, '试验河流渡河');
});

test('reconnaissance reports arrive later and update only the observer belief', () => {
  const queued = queueObservation(createFixture(), {
    observerSide: 'player',
    targetUnitId: 'enemy-main',
    reportedAreaId: 'valley',
    actualAreaId: 'ridge',
    delaySeconds: 2,
    confidence: 'medium',
  });
  assert.equal(queued.error, null);
  assert.deepEqual(viewBelief(queued.world, 'player').sightings, {});

  const beforeArrival = stepBattle(queued.world, 1);
  assert.deepEqual(viewBelief(beforeArrival, 'player').sightings, {});

  const afterArrival = stepBattle(beforeArrival, 1);
  const playerView = viewBelief(afterArrival, 'player');
  const enemyView = viewBelief(afterArrival, 'enemy');
  assert.equal(playerView.sightings['enemy-main'].areaId, 'valley');
  assert.equal(playerView.sightings['enemy-main'].confidence, 'medium');
  assert.deepEqual(playerView.sightings['enemy-main'].uncertainty.candidateAreaIds, ['valley', 'north']);
  assert.equal(playerView.sightings['enemy-main'].uncertainty.label, '可能偏离相邻区域');
  assert.equal(afterArrival.eventLog.find((event) => event.type === 'report_arrived').uncertainty.level, 'medium');
  assert.deepEqual(enemyView.sightings, {});
  assert.equal(playerView.enemyUnits, undefined);
  assert.equal(playerView.units, undefined);
});

test('same seed and command sequence produce the same battlefield result', () => {
  const run = () => {
    const issued = issueOrder(createFixture(), { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player-wing', targetAreaId: 'valley' }, { delaySeconds: 2 });
    const observed = queueObservation(issued.world, { observerSide: 'player', targetUnitId: 'enemy-main', reportedAreaId: 'valley', actualAreaId: 'ridge', delaySeconds: 1 });
    return stepBattle(observed.world, 5);
  };
  assert.deepEqual(run(), run());
});

test('invalid orders do not mutate the world', () => {
  const world = createFixture();
  const result = issueOrder(world, { type: BATTLE_ORDER_TYPES.MOVE, unitId: 'player-wing', targetAreaId: 'unknown' });
  assert.match(result.error, /不存在的区域/);
  assert.deepEqual(world.orders, []);
  assert.equal(world.units['player-wing'].location, 'north');
});

test('commander map projection only exposes known layers and keeps true enemy position out', () => {
  const world = createFixture();
  const initial = buildCommanderMapModel(world, {
    mapMarkers: [
      { areaId: 'north', type: 'camp', label: '营垒' },
      { areaId: 'north', type: 'granary', label: '粮仓', position: { x: 20, y: 36 } },
    ],
  });
  assert.equal(initial.friendlyUnits[0].areaId, 'north');
  assert.deepEqual(initial.reportedEnemySignals, []);
  assert.equal(initial.disclosure.rawEnemyUnitsIncluded, false);
  assert.equal(initial.landmarks.length, 2);
  assert.deepEqual(initial.landmarks[1].position, { x: 20, y: 36 });
  assert.equal(initial.routes.length, 2);

  const queued = queueObservation(world, {
    observerSide: 'player',
    targetUnitId: 'enemy-main',
    reportedAreaId: 'valley',
    actualAreaId: 'ridge',
    delaySeconds: 0,
  });
  const after = stepBattle(queued.world, 1);
  const projected = buildCommanderMapModel(after, { mapMarkers: [] });
  assert.equal(projected.reportedEnemySignals[0].areaId, 'valley');
  assert.deepEqual(projected.reportedEnemySignals[0].position, { x: 52, y: 55 });
  assert.deepEqual(projected.reportedEnemySignals[0].candidatePositions, [{ x: 52, y: 55 }, { x: 25, y: 30 }]);
  assert.equal(projected.reportedEnemySignals[0].uncertainty.label, '可能偏离相邻区域');
  assert.equal(projected.reportedEnemySignals[0].actualAreaId, undefined);
});

test('resolves deterministic combat exchanges when opposing units share an area', () => {
  const world = createBattleWorld({
    scenarioId: 'combat-test',
    seed: 7,
    areas: [{ id: 'valley', name: '谷地' }],
    units: [
      { id: 'player', side: 'player', name: '我方部队', location: 'valley', strength: 100, morale: 80, fatigue: 10, supplyDays: 3, readiness: .9 },
      { id: 'enemy', side: 'enemy', name: '敌方部队', location: 'valley', strength: 100, morale: 70, fatigue: 10, supplyDays: 3, readiness: .9 },
    ],
  });

  const after = stepBattle(world, 10);
  assert.ok(after.units.player.strength < 100);
  assert.ok(after.units.enemy.strength < 100);
  assert.ok(after.eventLog.some((event) => event.type === 'engagement_started'));
  assert.ok(after.eventLog.some((event) => event.type === 'combat_exchange'));
  assert.ok(after.eventLog.some((event) => event.type === 'observation_created' && event.sourceType === 'frontline-report'));
  assert.equal(after.engagements[0].exchangeCount, 2);
  assert.deepEqual(after, stepBattle(world, 10));
});

test('frontline combat reports arrive later and do not expose the enemy world state', () => {
  const world = createBattleWorld({
    scenarioId: 'combat-report-test',
    seed: 12,
    areas: [
      { id: 'west', name: '西侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
      { id: 'valley', name: '谷地', neighbors: [{ id: 'west', travelSeconds: 1 }, { id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方部队', location: 'valley', strength: 100, morale: 80, supplyDays: 3 },
      { id: 'enemy', side: 'enemy', name: '敌方部队', location: 'valley', strength: 100, morale: 70, supplyDays: 3 },
    ],
  });

  const beforeReport = stepBattle(world, 10);
  assert.deepEqual(viewBelief(beforeReport, 'player').sightings, {});
  assert.ok(beforeReport.observations.some((observation) => observation.sourceType === 'frontline-report' && observation.status === 'in_transit'));

  const afterReport = stepBattle(beforeReport, 5);
  const playerView = viewBelief(afterReport, 'player');
  assert.ok(playerView.sightings.enemy);
  assert.ok(['valley', 'west', 'east'].includes(playerView.sightings.enemy.areaId));
  assert.equal(playerView.enemyUnits, undefined);
  assert.equal(playerView.units, undefined);
  assert.ok(afterReport.eventLog.some((event) => event.type === 'report_arrived' && event.sourceType === 'frontline-report'));
});

test('enemy decisions follow their reported location and reports later expire', () => {
  const world = createBattleWorld({
    scenarioId: 'enemy-belief-ai-test',
    areas: [
      { id: 'west', name: '西侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
      { id: 'valley', name: '谷地', neighbors: [{ id: 'west', travelSeconds: 1 }, { id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方部队', location: 'valley', strength: 100, morale: 80, supplyDays: 3 },
      { id: 'enemy', side: 'enemy', name: '敌方部队', location: 'east', strength: 100, morale: 70, supplyDays: 3 },
    ],
  });
  world.ai.intervalSeconds = 1;
  const queued = queueObservation(world, {
    observerSide: 'enemy',
    targetUnitId: 'player',
    reportedAreaId: 'west',
    actualAreaId: 'valley',
    delaySeconds: 0,
    freshnessSeconds: 3,
    confidence: 'low',
    sourceType: '误报渠道',
  });

  const afterReport = stepBattle(queued.world, 1);
  assert.equal(afterReport.orders[0].unitId, 'enemy');
  assert.equal(afterReport.orders[0].targetAreaId, 'west');
  assert.notEqual(afterReport.orders[0].targetAreaId, 'valley');

  const afterExpiry = stepBattle(afterReport, 3);
  assert.deepEqual(viewBelief(afterExpiry, 'enemy').sightings, {});
  assert.ok(afterExpiry.eventLog.some((event) => event.type === 'report_expired' && event.observerSide === 'enemy'));
});

test('enemy belief reactions become delayed and imperfect reports for the player', () => {
  const world = createBattleWorld({
    scenarioId: 'enemy-reaction-report-test',
    areas: [
      { id: 'west', name: '西侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
      { id: 'valley', name: '谷地', neighbors: [{ id: 'west', travelSeconds: 1 }, { id: 'east', travelSeconds: 1 }] },
      { id: 'east', name: '东侧', neighbors: [{ id: 'valley', travelSeconds: 1 }] },
    ],
    units: [
      { id: 'player', side: 'player', name: '我方部队', location: 'valley', strength: 100, morale: 80, supplyDays: 3 },
      { id: 'enemy', side: 'enemy', name: '敌方部队', location: 'east', strength: 100, morale: 70, supplyDays: 3 },
    ],
  });
  world.ai.intervalSeconds = 1;
  const queued = queueObservation(world, {
    observerSide: 'enemy',
    targetUnitId: 'player',
    reportedAreaId: 'west',
    actualAreaId: 'valley',
    delaySeconds: 0,
    freshnessSeconds: 30,
    confidence: 'low',
    sourceType: '误报渠道',
  });

  const afterDecision = stepBattle(queued.world, 1);
  assert.equal(afterDecision.orders.find((order) => order.unitId === 'enemy')?.targetAreaId, 'west');
  assert.deepEqual(viewBelief(afterDecision, 'player').sightings, {});
  const pendingReport = afterDecision.observations.find((observation) => observation.sourceType === 'frontline-report');
  assert.equal(pendingReport.status, 'in_transit');
  assert.equal(pendingReport.reportedAreaId, 'west');
  assert.equal(pendingReport.confidence, 'low');
  assert.ok(pendingReport.arrivesAt > afterDecision.simTime);
  const createdEvent = afterDecision.eventLog.find((event) => event.type === 'observation_created' && event.observerSide === 'player');
  assert.ok(createdEvent);
  assert.equal(Object.prototype.hasOwnProperty.call(createdEvent, 'actualAreaId'), false);
  assert.equal(afterDecision.eventLog.some((event) => event.type === 'ai_decision' && event.side === 'enemy'), true);

  const afterReport = stepBattle(afterDecision, 5);
  const playerView = viewBelief(afterReport, 'player');
  assert.equal(playerView.sightings.enemy.areaId, 'west');
  assert.equal(playerView.sightings.enemy.confidence, 'low');
  assert.deepEqual(playerView.sightings.enemy.uncertainty.candidateAreaIds, ['west', 'valley']);
  assert.equal(playerView.sightings.enemy.actualAreaId, undefined);
  const arrivedEvent = afterReport.eventLog.find((event) => event.type === 'report_arrived' && event.observerSide === 'player');
  assert.ok(arrivedEvent);
  assert.equal(arrivedEvent.sourceType, 'frontline-report');
  assert.equal(Object.prototype.hasOwnProperty.call(arrivedEvent, 'actualAreaId'), false);
});

test('consumes one day of supply and records depletion pressure', () => {
  const world = createBattleWorld({
    scenarioId: 'logistics-test',
    areas: [{ id: 'north', name: '北口' }],
    units: [{ id: 'unit', side: 'player', name: '孤军', location: 'north', strength: 100, morale: 50, fatigue: 10, supplyDays: 1, readiness: 1 }],
  });

  const after = stepBattle(world, 60);
  const unit = after.units.unit;
  assert.equal(unit.supplyDays, 0);
  assert.equal(unit.fatigue, 11);
  assert.equal(unit.morale, 48);
  assert.ok(unit.readiness < 1);
  assert.ok(after.eventLog.some((event) => event.type === 'supply_depleted'));

  const next = stepBattle(after, 60);
  assert.equal(next.units.unit.supplyDays, 0);
  assert.equal(next.units.unit.morale, 46);
});
