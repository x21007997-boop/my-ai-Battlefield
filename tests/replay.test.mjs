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
      { id: 'game-event-0004a', schemaVersion: 1, simTime: 3, type: 'unit_departed', payload: { unitId: 'qin-main', areaId: 'qin-west-camp' } },
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

test('replay reconstructs friendly movement trajectories from commander-safe events', () => {
  const state = replayCommanderEvents(snapshot(), {
    friendlyUnits: [{ id: 'qin-main', areaId: 'qin-west-camp' }],
    untilTime: 4,
  });
  assert.deepEqual(state.replayTrajectories, [{
    unitId: 'qin-main',
    kind: 'replay-trajectory',
    confidence: 'high',
    areaIds: ['qin-west-camp', 'dan-river-valley'],
    points: [
      { areaId: 'qin-west-camp', simTime: 3 },
      { areaId: 'dan-river-valley', simTime: 4 },
    ],
  }]);
  assert.equal(JSON.stringify(state.replayTrajectories).includes('actualAreaId'), false);
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

test('replay preserves a deputy route adjustment without exposing battlefield truth', () => {
  const snapshotWithRouteChange = {
    schemaVersion: 1,
    scenarioId: 'route-replay-test',
    disclosure: { rawEnemyTruthIncluded: false, combatExchangeIncluded: false },
    events: [
      { schemaVersion: 1, simTime: 0, type: 'order_issued', payload: { orderId: 'order-0001', unitId: 'wing', targetAreaId: 'pass', route: ['camp', 'pass'], totalTravelSeconds: 4 } },
      { schemaVersion: 1, simTime: 1, type: 'order_delivered', payload: { orderId: 'order-0001', unitId: 'wing' } },
      { schemaVersion: 1, simTime: 1, type: 'officer_decision', payload: { orderId: 'order-0001', subjectType: 'order', decision: 'modified', rationale: '改走谷道', executionDelaySeconds: 1, executionRate: 0.75, routeAdjustment: { decision: 'reroute' } } },
      { schemaVersion: 1, simTime: 1, type: 'officer_route_changed', payload: { orderId: 'order-0001', selectedRoute: ['camp', 'valley', 'pass'], selectedTravelSeconds: 2 } },
    ],
  };
  const state = replayCommanderEvents(snapshotWithRouteChange, { friendlyUnits: [{ id: 'wing', areaId: 'camp' }], untilTime: 1 });
  assert.deepEqual(state.order.route, ['camp', 'valley', 'pass']);
  assert.equal(state.order.totalTravelSeconds, 2);
  assert.equal(state.order.executionRate, 0.75);
  assert.equal(state.order.officerDecision.routeAdjustment.decision, 'reroute');
});
