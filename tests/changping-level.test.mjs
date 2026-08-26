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
  assert.equal(world.areas['western-gate'].neighbors.find((item) => item.id === 'qin-west-camp').travelSeconds, 10);
  assert.equal(world.areas['dan-river-valley'].neighbors.find((item) => item.id === 'qin-west-camp').travelSeconds, 14);
  assert.equal(world.areas['zhao-main-camp'].neighbors.find((item) => item.id === 'zhao-relief-route').travelSeconds, 11);
  assert.equal(world.terrainFeatures.find((feature) => feature.id === 'dan-river').type, 'river');
  assert.equal(world.areas['qin-west-camp'].neighbors.find((item) => item.id === 'dan-river-valley').terrainTransitions[0].transitionType, 'river-crossing');
});

test('Changping level can reach a safe commander-visible victory review', () => {
  let world = CHANGPING_PROFILE.createWorld();
  let response = command(world, { type: 'move', unitId: 'qin-main', targetAreaId: 'dan-river-valley' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'move', unitId: 'qin-detachment', targetAreaId: 'zhao-relief-route' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'scout' });
  assert.equal(response.accepted, true);
  world = response.world;

  response = command(world, { type: 'advance', seconds: 40 });
  assert.equal(response.accepted, true);
  assert.equal(response.world.status, 'ended');
  assert.equal(response.world.outcome.id, 'qin-isolate-relief');
  assert.equal(response.world.outcome.side, 'player');
  assert.equal(response.world.outcome.title, '秦军完成隔离态势');

  const session = response.response.session;
  assert.equal(session.status, 'ended');
  assert.equal(session.review.resultLabel, '秦军达成战役目标');
  assert.equal(session.review.stats.commandCount, 2);
  assert.equal(session.review.stats.reportCount, 1);
  assert.equal(session.objectives.every((objective) => objective.status === 'achieved'), true);
  assert.equal(JSON.stringify(session).includes('actualAreaId'), false);
  assert.equal(JSON.stringify(session).includes('combatExchange'), false);
});
