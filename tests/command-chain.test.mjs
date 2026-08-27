import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommanderCommand,
  buildCommandDeliveryPlan,
  commanderLocation,
  createBattleWorld,
  interpretCommanderInstruction,
  officerDecisionLabel,
  stepBattle,
} from '../src/battlefield/index.js';
import { CHANGPING_PROFILE } from '../src/battlefield/changpingScenario.js';

function createWorld() {
  return createBattleWorld({
    scenarioId: 'command-chain-test',
    areas: [
      { id: 'west', name: '西侧营地', position: { x: 20, y: 50 }, neighbors: [{ id: 'east', travelSeconds: 4 }] },
      { id: 'east', name: '东侧高地', position: { x: 80, y: 50 }, neighbors: [{ id: 'west', travelSeconds: 4 }] },
    ],
    units: [
      { id: 'main', side: 'player', name: '秦军主力', unitType: 'field-army', commanderId: 'general', location: 'west', strength: 100 },
      { id: 'wing', side: 'player', name: '秦军机动部队', unitType: 'detachment', commanderId: 'deputy', location: 'east', strength: 40 },
      { id: 'enemy', side: 'enemy', name: '赵军疑似主力', location: 'east', strength: 100 },
    ],
    sides: [
      { id: 'player', name: '秦军' },
      { id: 'enemy', name: '赵军' },
    ],
    commanders: [
      { id: 'general', side: 'player', name: '统帅', role: '秦军统帅', isPlayer: true, locationAreaId: 'west' },
      { id: 'deputy', side: 'player', name: '王副将', role: '前线副将', superiorCommanderId: 'general', attachedUnitId: 'wing', locationStatus: 'with_unit' },
    ],
    commandChain: {
      playerCommanderIdsBySide: { player: 'general' },
      messengerPolicy: { baseDelaySeconds: 1, routeTravelFactor: 0.5, fallbackDelaySeconds: 4, directDelaySeconds: 0 },
    },
  });
}

test('command delivery distinguishes a direct order from a messenger route', () => {
  const world = createWorld();
  const direct = buildCommandDeliveryPlan(world, {
    side: 'player',
    issuerCommanderId: 'general',
    recipientCommanderId: 'general',
    unitId: 'main',
  });
  assert.equal(direct.mode, 'direct');
  assert.equal(direct.delaySeconds, 0);

  const remote = buildCommandDeliveryPlan(world, {
    side: 'player',
    issuerCommanderId: 'general',
    recipientCommanderId: 'deputy',
    unitId: 'wing',
  });
  assert.equal(remote.mode, 'messenger');
  assert.equal(remote.delaySeconds, 3);
  assert.deepEqual(remote.context.commandPath, ['west', 'east']);
  assert.equal(remote.context.messenger.status, 'in_transit');
});

test('a remote deputy receives the order before the unit begins moving', () => {
  const issued = applyCommanderCommand(createWorld(), {
    type: 'move',
    unitId: 'wing',
    targetAreaId: 'west',
    recipientCommanderId: 'deputy',
    rawText: '令王副将率机动部队向西侧营地推进',
  }, { side: 'player' });

  assert.equal(issued.accepted, true);
  assert.equal(issued.result.recipientCommanderId, 'deputy');
  assert.equal(issued.result.communicationMode, 'messenger');
  assert.equal(issued.result.status, 'transmitting');
  assert.equal(issued.result.deliverAt, 3);
  assert.equal(commanderLocation(issued.world, 'deputy').areaId, 'east');

  const beforeDelivery = stepBattle(issued.world, 2);
  assert.equal(beforeDelivery.units.wing.location, 'east');
  assert.equal(beforeDelivery.orders[0].status, 'transmitting');

  const delivered = stepBattle(beforeDelivery, 1);
  assert.equal(delivered.orders[0].status, 'executing');
  assert.equal(delivered.orders[0].messenger.status, 'delivered');
  assert.equal(delivered.orders[0].officerDecision.decision, 'accepted');
  assert.match(delivered.orders[0].officerFeedback, /王副将/);
  assert.equal(officerDecisionLabel(delivered.orders[0].officerDecision.decision), '接受执行');
  assert.ok(delivered.eventLog.some((event) => event.type === 'command_delivered' && event.recipientCommanderId === 'deputy'));
  assert.ok(delivered.eventLog.some((event) => event.type === 'officer_decision' && event.officerId === 'deputy'));

  const arrived = stepBattle(delivered, 3);
  assert.equal(arrived.units.wing.location, 'west');
  assert.equal(commanderLocation(arrived, 'deputy').areaId, 'west');
});

test('the command chain rejects a deputy trying to command another officer\'s unit', () => {
  const result = applyCommanderCommand(createWorld(), {
    type: 'hold',
    unitId: 'main',
    recipientCommanderId: 'deputy',
  }, { side: 'player' });
  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, 'COMMANDER_AUTHORITY');
});

test('free-form commander instruction resolves a named officer and unit', () => {
  const world = createWorld();
  const interpretation = interpretCommanderInstruction(world, {
    side: 'player',
    text: '让王副将率秦军机动部队向西侧营地推进',
  });
  assert.equal(interpretation.error, null);
  assert.equal(interpretation.command.type, 'move');
  assert.equal(interpretation.command.recipientCommanderId, 'deputy');
  assert.equal(interpretation.command.unitId, 'wing');
  assert.equal(interpretation.command.targetAreaId, 'west');
  assert.equal(interpretation.interpretation.engine, 'rule-based-v1');
  assert.equal(interpretation.interpretation.confidence, 'high');

  const submitted = applyCommanderCommand(world, {
    type: 'free_order',
    text: '让王副将率秦军机动部队向西侧营地推进',
  }, { side: 'player' });
  assert.equal(submitted.accepted, true);
  assert.equal(submitted.result.communicationMode, 'messenger');
  assert.ok(submitted.world.eventLog.some((event) => event.type === 'command_interpreted'));
});

test('free-form instruction accepts the short name of a caveated historical area', () => {
  const interpretation = interpretCommanderInstruction(CHANGPING_PROFILE.createWorld(), {
    side: 'player',
    text: '让王龁率秦军机动部队向丹水河谷推进',
  });
  assert.equal(interpretation.error, null);
  assert.equal(interpretation.command.targetAreaId, 'dan-river-valley');
});

test('officer delays a low-readiness order before movement begins', () => {
  const world = createBattleWorld({
    scenarioId: 'officer-readiness-test',
    areas: [
      { id: 'camp', name: '营地', position: { x: 20, y: 50 }, neighbors: [{ id: 'pass', travelSeconds: 3 }] },
      { id: 'pass', name: '关口', position: { x: 80, y: 50 }, neighbors: [{ id: 'camp', travelSeconds: 3 }] },
    ],
    units: [{ id: 'wing', side: 'player', name: '前锋', commanderId: 'deputy', location: 'camp', strength: 40, morale: 42, fatigue: 22, supplyDays: 4, readiness: 0.7 }],
    sides: [{ id: 'player', name: '秦军' }, { id: 'enemy', name: '赵军' }],
    commanders: [
      { id: 'general', side: 'player', name: '统帅', role: '统帅', isPlayer: true, locationAreaId: 'camp' },
      { id: 'deputy', side: 'player', name: '疲惫副将', role: '前线副将', superiorCommanderId: 'general', attachedUnitId: 'wing', locationStatus: 'with_unit' },
    ],
    commandChain: { playerCommanderIdsBySide: { player: 'general' }, messengerPolicy: { directDelaySeconds: 0 } },
  });
  const issued = applyCommanderCommand(world, { type: 'move', unitId: 'wing', targetAreaId: 'pass', recipientCommanderId: 'deputy' }, { side: 'player' });
  const delivered = stepBattle(issued.world, 1);
  assert.equal(delivered.orders[0].officerDecision.decision, 'delayed');
  assert.equal(delivered.orders[0].executionResumeAt, 4);
  assert.equal(delivered.units.wing.location, 'camp');
  assert.match(delivered.orders[0].officerFeedback, /休整/);

  const resumed = stepBattle(delivered, 3);
  assert.equal(resumed.orders[0].executionResumeAt, null);
  assert.equal(resumed.units.wing.location, 'camp');
  assert.ok(resumed.eventLog.some((event) => event.type === 'officer_delay_completed'));
});
