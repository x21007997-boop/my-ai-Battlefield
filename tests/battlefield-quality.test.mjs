import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_ERROR_CODES,
  BATTLEFIELD_CONFIG,
  BattleValidationError,
  createBattleWorld,
  handleCommanderRequest,
  issueOrder,
  queueObservation,
} from '../src/battlefield/index.js';

function createWorld() {
  return createBattleWorld({
    scenarioId: 'quality-test',
    areas: [{ id: 'west', name: '西侧' }],
    units: [{ id: 'player', side: 'player', name: '我方', location: 'west', strength: 100 }],
  });
}

test('central battlefield policy is the single source for runtime defaults', () => {
  assert.equal(BATTLEFIELD_CONFIG.defaults.areaTravelSeconds, 10);
  assert.equal(BATTLEFIELD_CONFIG.defaults.aiIntervalSeconds, 15);
  assert.equal(BATTLEFIELD_CONFIG.defaults.combatIntervalSeconds, 10);
  assert.equal(BATTLEFIELD_CONFIG.defaults.supplyTickSeconds, 60);
  assert.equal(BATTLEFIELD_CONFIG.defaults.maxAdvanceSeconds, 3600);
  assert.deepEqual(BATTLEFIELD_CONFIG.mapBounds, { x: [0, 100], y: [0, 100] });
  assert.equal(BATTLEFIELD_CONFIG.schemaVersions.world, createWorld().schemaVersion);
  assert.equal(new Set(Object.values(BATTLE_ERROR_CODES)).size, Object.values(BATTLE_ERROR_CODES).length);
});

test('invalid core operations expose stable error codes without removing messages', () => {
  const invalidOrder = issueOrder(createWorld(), { type: 'move', unitId: 'missing', targetAreaId: 'west' });
  assert.equal(invalidOrder.errorCode, BATTLE_ERROR_CODES.UNIT_NOT_FOUND);
  assert.match(invalidOrder.error, /部队/);

  const invalidObservation = queueObservation(createWorld(), {
    observerSide: 'player',
    targetUnitId: 'missing',
    reportedAreaId: 'west',
  });
  assert.equal(invalidObservation.errorCode, BATTLE_ERROR_CODES.OBSERVATION_TARGET_NOT_FOUND);
  assert.match(invalidObservation.error, /观察目标/);

  const invalidGatewayCommand = handleCommanderRequest(createWorld(), {
    command: { type: 'unknown-command' },
  });
  assert.equal(invalidGatewayCommand.errorCode, BATTLE_ERROR_CODES.UNSUPPORTED_COMMAND);
  assert.match(invalidGatewayCommand.error, /不支持/);
});

test('validation exceptions carry a machine-readable code', () => {
  assert.throws(
    () => handleCommanderRequest(createWorld(), { command: { type: 'snapshot' } }, { side: 'missing-side' }),
    (error) => error instanceof BattleValidationError && error.code === BATTLE_ERROR_CODES.BELIEF_NOT_FOUND,
  );
});
