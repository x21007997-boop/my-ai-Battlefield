import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { queueObservation } from './perception.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';

export const DECEPTION_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.deception;

function nextDeceptionId(world) {
  return `deception-${String((world.deception?.history ?? []).length + 1).padStart(4, '0')}`;
}

function oppositeSide(world, side) {
  return Object.keys(world.sides ?? {}).find((candidate) => candidate !== side) ?? null;
}

function actionFor(world, actionId) {
  return world.deception?.actions?.[actionId] ?? null;
}

/**
 * Inject a scenario-defined false report into the opposing belief state.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {Record<string, unknown>} [options]
 */
export function issueDeception(world, {
  side = 'player',
  actionId,
  targetSide,
  targetUnitId,
  reportedAreaId,
  delaySeconds,
  freshnessSeconds,
  confidence,
  sourceType,
  observation,
} = {}) {
  const next = cloneBattleWorld(world);
  const action = actionFor(next, actionId);
  if (!action) return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_NOT_FOUND, '当前场景没有这项计策。', { actionId }) };
  if (action.side && action.side !== side) return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_SIDE_FORBIDDEN, '当前阵营不能使用这项计策。', { actionId, side }) };

  const subjectUnitId = targetUnitId ?? action.targetUnitId;
  const subjectUnit = next.units[subjectUnitId];
  if (!subjectUnit || subjectUnit.side !== side) return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_SUBJECT_INVALID, '计策必须以本方一支部队作为假情报对象。', { targetUnitId: subjectUnitId, side }) };

  const recipientSide = targetSide ?? action.targetSide ?? oppositeSide(next, side);
  if (!recipientSide || !next.sides[recipientSide] || recipientSide === side) {
    return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_RECIPIENT_INVALID, '计策缺少有效的敌方认知对象。', { targetSide: recipientSide }) };
  }

  const cooldownSeconds = Math.max(0, Math.floor(action.cooldownSeconds ?? BATTLEFIELD_CONFIG.defaults.deceptionCooldownSeconds));
  const lastIssuedAt = next.deception.lastIssuedAtBySide?.[`${side}:${actionId}`];
  if (lastIssuedAt != null && next.simTime - lastIssuedAt < cooldownSeconds) {
    return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_COOLDOWN, `这项计策仍在冷却，还需 ${cooldownSeconds - (next.simTime - lastIssuedAt)} 秒。`, { actionId, remainingSeconds: cooldownSeconds - (next.simTime - lastIssuedAt) }) };
  }

  const falseAreaId = reportedAreaId ?? action.reportedAreaId;
  if (!falseAreaId || !next.areas[falseAreaId]) return { world: next, deception: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_AREA_INVALID, '计策缺少有效的误导区域。', { areaId: falseAreaId }) };

  const observationResult = queueObservation(next, {
    observerSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    actualAreaId: subjectUnit.location,
    delaySeconds: delaySeconds ?? action.delaySeconds ?? BATTLEFIELD_CONFIG.defaults.deceptionReportDelaySeconds,
    confidence: confidence ?? action.confidence ?? 'medium',
    sourceId: action.sourceId ?? null,
    sourceReliability: action.sourceReliability ?? 'variable',
    freshnessSeconds: freshnessSeconds ?? action.freshnessSeconds ?? BATTLEFIELD_CONFIG.defaults.reportFreshnessSeconds,
    sourceType: sourceType ?? action.sourceType ?? 'deception',
    observation: observation ?? action.observation ?? action.name ?? '敌军传来一则未经证实的消息',
  });
  if (observationResult.error) return {
    world: observationResult.world,
    deception: null,
    error: observationResult.error,
    errorCode: observationResult.errorCode,
    errorDetails: observationResult.errorDetails,
  };

  const deception = {
    id: nextDeceptionId(observationResult.world),
    schemaVersion: DECEPTION_SCHEMA_VERSION,
    side,
    actionId,
    targetSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    observationId: observationResult.observation.id,
    issuedAt: observationResult.world.simTime,
    status: 'queued',
  };
  const result = observationResult.world;
  result.deception.history.push(deception);
  result.deception.lastIssuedAtBySide[`${side}:${actionId}`] = result.simTime;
  appendBattleEvent(result, {
    type: 'deception_issued',
    side,
    deceptionId: deception.id,
    actionId,
    targetSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    observationId: observationResult.observation.id,
  });
  return { world: result, deception, error: null, errorCode: null, errorDetails: {} };
}
