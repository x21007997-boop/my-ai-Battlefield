import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommanderReplayEvent,
  createCommanderReplayState,
  replayCommanderEvents,
  validateCommanderReplay,
} from '../src/battlefield/index.js';

function snapshot() {
  return {
    schemaVersion: 1,
    scenarioId: 'changping-260',
    disclosure: { rawEnemyTruthIncluded: false, combatExchangeIncluded: false },
    events: [
      { id: 'game-event-0001', schemaVersion: 1, simTime: 0, type: 'scenario_loaded', payload: {} },
      { id: 'game-event-0002', schemaVersion: 1, simTime: 0, type: 'commander_target_selected', payload: { areaId: 'dan-river-valley' } },
      { id: 'game-event-0003', schemaVersion: 1, simTime: 0, type: 'order_issued', payload: { unitId: 'qin-main', targetAreaId: 'dan-river-valley', completeAt: 4 } },
      { id: 'game-event-0004', schemaVersion: 1, simTime: 3, type: 'order_delivered', payload: { unitId: 'qin-main', targetAreaId: 'dan-river-valley' } },
      { id: 'game-event-0005', schemaVersion: 1, simTime: 4, type: 'unit_arrived', payload: { unitId: 'qin-main', areaId: 'dan-river-valley' } },
      { id: 'game-event-0006', schemaVersion: 1, simTime: 5, type: 'observation_queued', payload: { reportedAreaId: 'zhao-main-camp', arrivesAt: 8 } },
      { id: 'game-event-0007', schemaVersion: 1, simTime: 8, type: 'report_arrived', payload: { reportId: 'report-0001', reportedAreaId: 'zhao-main-camp', confidence: 'medium', expiresAt: 20 } },
    ],
  };
}

test('rebuilds commander state at a selected replay time', () => {
  const state = replayCommanderEvents(snapshot(), {
    friendlyUnits: [{ id: 'qin-main', areaId: 'qin-west-camp' }],
    untilTime: 6,
  });
  assert.equal(state.simTime, 6);
  assert.equal(state.friendlyUnits[0].areaId, 'dan-river-valley');
  assert.equal(state.order.status, 'completed');
  assert.equal(state.reportedSignals.length, 0);
  assert.equal(state.selectedTargetAreaId, 'dan-river-valley');
});

test('replay applies reports without exposing actual positions', () => {
  const state = replayCommanderEvents(snapshot(), {
    friendlyUnits: [{ id: 'qin-main', areaId: 'qin-west-camp' }],
    untilTime: 8,
  });
  assert.equal(state.reportedSignals[0].areaId, 'zhao-main-camp');
  assert.equal(state.reportedSignals[0].actualAreaId, undefined);
  assert.equal(state.reportedSignals[0].confidence, 'medium');
});

test('replay validation rejects truth-bearing payloads', () => {
  const unsafe = snapshot();
  unsafe.events.push({ id: 'unsafe', schemaVersion: 1, simTime: 9, type: 'debug', payload: { actualAreaId: 'zhao-relief-route' } });
  assert.ok(validateCommanderReplay(unsafe).some((error) => error.includes('actualAreaId')));
});

test('replay event reducer keeps a bounded commander timeline', () => {
  let state = createCommanderReplayState({ friendlyUnits: [{ id: 'qin-main', areaId: 'qin-west-camp' }] });
  for (let index = 0; index < 20; index += 1) {
    state = applyCommanderReplayEvent(state, { schemaVersion: 1, simTime: index, type: 'unknown_event', payload: {} });
  }
  assert.equal(state.timeline.length, 12);
  assert.equal(state.eventCount, 20);
  assert.equal(state.timeline[0].simTime, 8);
});
