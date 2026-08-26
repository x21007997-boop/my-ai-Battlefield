import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommanderSessionSnapshot,
  createBattleWorld,
  queueObservation,
  stepBattle,
  viewBelief,
} from '../src/battlefield/index.js';

function createWorld() {
  const world = createBattleWorld({
    scenarioId: 'counter-intelligence-test',
    areas: [
      { id: 'north', name: '北口', position: { x: 50, y: 20 }, neighbors: [{ id: 'west', travelSeconds: 10 }, { id: 'east', travelSeconds: 10 }] },
      { id: 'west', name: '西侧', position: { x: 20, y: 50 }, neighbors: [{ id: 'north', travelSeconds: 10 }] },
      { id: 'east', name: '东侧', position: { x: 80, y: 50 }, neighbors: [{ id: 'north', travelSeconds: 10 }] },
    ],
    units: [
      { id: 'enemy', side: 'enemy', name: '敌方机动部队', location: 'north', strength: 100 },
      { id: 'player', side: 'player', name: '我方部队', location: 'east', strength: 100 },
    ],
  });
  world.ai.intervalSeconds = 1;
  return world;
}

test('enemy verifies a weak report, discredits a false location, and redirects its order', () => {
  const queued = queueObservation(createWorld(), {
    observerSide: 'enemy',
    targetUnitId: 'player',
    reportedAreaId: 'west',
    actualAreaId: 'east',
    delaySeconds: 0,
    confidence: 'medium',
    sourceReliability: 'variable',
    sourceIndependenceGroup: 'rumor-network',
    sourceType: '流言渠道',
  });

  const reacted = stepBattle(queued.world, 1);
  const falseReport = reacted.beliefs.enemy.reports.find((report) => report.sourceType === '流言渠道');
  assert.ok(falseReport);
  assert.equal(reacted.orders.find((order) => order.unitId === 'enemy')?.targetAreaId, 'west');
  assert.equal(reacted.beliefs.enemy.counterIntelligence.reviews[falseReport.id].status, 'verification_pending');
  assert.ok(reacted.observations.some((observation) => observation.sourceType === 'counter-scout' && observation.status === 'in_transit'));

  const corrected = stepBattle(reacted, 5);
  const enemyBelief = viewBelief(corrected, 'enemy');
  assert.equal(enemyBelief.sightings.player.areaId, 'east');
  assert.equal(corrected.beliefs.enemy.reports.find((report) => report.id === falseReport.id).status, 'discredited');
  assert.ok(corrected.eventLog.some((event) => event.type === 'ai_verification_requested'));
  assert.ok(corrected.eventLog.some((event) => event.type === 'report_reliability_reduced'));
  assert.ok(corrected.eventLog.some((event) => event.type === 'deception_detected'));
  assert.ok(corrected.orders.some((order) => order.targetAreaId === 'west' && order.status === 'cancelled'));
  assert.ok(corrected.orders.some((order) => order.unitId === 'enemy' && order.targetAreaId === 'east'));

  const commanderSession = buildCommanderSessionSnapshot(corrected, { side: 'player' });
  assert.equal(JSON.stringify(commanderSession).includes('actualAreaId'), false);
  assert.equal(commanderSession.eventLog.some((event) => event.type === 'deception_detected'), false);
});

test('enemy holds position when independent reports conflict before verification', () => {
  let world = createWorld();
  world = queueObservation(world, {
    observerSide: 'enemy',
    targetUnitId: 'player',
    reportedAreaId: 'west',
    actualAreaId: 'east',
    delaySeconds: 0,
    confidence: 'medium',
    sourceReliability: 'variable',
    sourceIndependenceGroup: 'rumor-network',
    sourceType: '流言渠道',
  }).world;
  world = queueObservation(world, {
    observerSide: 'enemy',
    targetUnitId: 'player',
    reportedAreaId: 'east',
    actualAreaId: 'east',
    delaySeconds: 0,
    confidence: 'high',
    sourceReliability: 'high',
    sourceIndependenceGroup: 'forward-scouts',
    sourceType: '前出斥候',
  }).world;

  const held = stepBattle(world, 1);
  assert.equal(held.orders.length, 0);
  assert.ok(held.eventLog.some((event) => event.type === 'ai_hold_position' && event.side === 'enemy'));
  assert.equal(Object.values(held.beliefs.enemy.counterIntelligence.reviews).length, 1);

  const resolved = stepBattle(held, 5);
  assert.ok(resolved.eventLog.some((event) => event.type === 'deception_detected'));
  assert.ok(resolved.orders.some((order) => order.unitId === 'enemy' && order.targetAreaId === 'east'));
});
