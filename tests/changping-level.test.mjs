import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGPING_PROFILE } from '../src/battlefield/changpingScenario.js';
import { handleCommanderRequest } from '../src/battlefield/index.js';

function command(world, value) {
  return handleCommanderRequest(world, { command: value }, {
    side: 'player',
    commandDelaySeconds: CHANGPING_PROFILE.commandDelaySeconds,
    scout: CHANGPING_PROFILE.scout,
  });
}

test('Changping level keeps route estimates playable in both directions', () => {
  const world = CHANGPING_PROFILE.createWorld();
  assert.equal(world.areas['western-gate'].neighbors.find((item) => item.id === 'qin-west-camp').distanceLi, 8);
  assert.equal(world.areas['dan-river-valley'].neighbors.find((item) => item.id === 'qin-west-camp').distanceLi, 14);
  assert.equal(world.areas['zhao-main-camp'].neighbors.find((item) => item.id === 'zhao-relief-route').distanceLi, 15);
  const riverRoute = world.areas['qin-west-camp'].neighbors.find((item) => item.id === 'dan-river-valley');
  assert.equal(riverRoute.distanceLi, 14);
  assert.equal(riverRoute.distanceStatus, 'scenario_assumption');
  assert.equal(riverRoute.roadType, 'river-valley-track');
  assert.equal(riverRoute.baggageAccess, 'limited');
  assert.equal(world.terrainFeatures.find((feature) => feature.id === 'dan-river').type, 'river');
  assert.equal(riverRoute.terrainTransitions[0].transitionType, 'river-crossing');
  assert.equal(riverRoute.points.length, 4);
  assert.deepEqual(riverRoute.points[0], world.areas['qin-west-camp'].position);
  const reversedRiverRoute = world.areas['dan-river-valley'].neighbors.find((item) => item.id === 'qin-west-camp');
  assert.deepEqual(reversedRiverRoute.points, [...riverRoute.points].reverse());
  const issued = command(world, { type: 'move', unitId: 'qin-main', targetAreaId: 'dan-river-valley' });
  assert.equal(issued.world.orders[0].routeSegments[0].travelTimeSource, 'mobility-model');
  assert.deepEqual(issued.world.orders[0].routeSegments[0].points, riverRoute.points);
  assert.notEqual(issued.world.orders[0].routeSegments[0].travelSeconds, riverRoute.travelSeconds);
});

test('Changping level does not resolve from arrival alone', () => {
  let world = CHANGPING_PROFILE.createWorld();
  world = command(world, { type: 'move', unitId: 'qin-main', targetAreaId: 'dan-river-valley' }).world;
  world = command(world, { type: 'move', unitId: 'qin-detachment', targetAreaId: 'zhao-relief-route' }).world;
  world = command(world, { type: 'scout' }).world;
  world = command(world, { type: 'advance', seconds: 330 }).world;
  assert.equal(world.status, 'running');
  assert.equal(world.resolutionProgress.victory.status, 'not_started');
  assert.equal(buildTaskStatus(world), 'missing');
});

function buildTaskStatus(world) {
  return world.blockades.some((blockade) => blockade.status === 'active') ? 'active' : 'missing';
}

test('Changping level can reach a safe commander-visible victory review', () => {
  let world = CHANGPING_PROFILE.createWorld();
  let response = command(world, { type: 'move', unitId: 'qin-main', targetAreaId: 'dan-river-valley' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'blockade', unitId: 'qin-detachment', targetAreaId: 'zhao-relief-route' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'scout' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'advance', seconds: 1000 });
  assert.equal(response.accepted, true);
  assert.equal(response.world.status, 'ended');
  assert.equal(response.world.outcome.id, 'qin-isolate-relief');
  assert.equal(response.world.outcome.side, 'player');
  assert.equal(response.world.outcome.title, '秦军完成隔离态势');
  assert.equal(response.world.outcome.reason, 'victory_conditions_held');

  const session = response.response.session;
  assert.equal(session.status, 'ended');
  assert.equal(session.review.resultLabel, '秦军达成战役目标');
  assert.equal(session.review.stats.commandCount, 2);
  assert.ok(session.review.stats.reportCount >= 1);
  assert.equal(session.objectives.every((objective) => objective.status === 'achieved'), true);
  assert.equal(session.resolution.victory.holdStatus, 'holding');
  assert.equal(session.resolution.victory.holdElapsedSeconds, 600);
  assert.equal(session.resolution.victory.requiredTaskEffects[0].status, 'achieved');
  assert.equal(JSON.stringify(session).includes('actualAreaId'), false);
  assert.equal(JSON.stringify(session).includes('combatExchange'), false);
});
