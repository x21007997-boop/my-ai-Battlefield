import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { queueObservation } from './perception.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';
import { resourceCostError, spendResources } from './resources.js';
import {
  ensureStrategyState,
  exposureTriggered,
  nextStrategyActionId,
  recordStrategyReliabilityLoss,
  registerStrategyIssue,
  sourceReliabilityScore,
} from './strategy.js';

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

function normalizeSeconds(value, fallback = 0) {
  return Math.max(0, Math.floor(Number(value ?? fallback) || 0));
}

function queueOptionsFor(world, strategyAction, deception, action, compromised = false) {
  const sourceReliability = compromised ? 'low' : action.sourceReliability ?? 'variable';
  return {
    observerSide: deception.targetSide,
    targetUnitId: deception.targetUnitId,
    reportedAreaId: deception.reportedAreaId,
    actualAreaId: strategyAction.actualAreaId,
    delaySeconds: deception.reportDelaySeconds + (compromised ? deception.exposureDelaySeconds : 0),
    confidence: compromised ? 'low' : deception.confidence,
    sourceId: action.sourceId ?? null,
    sourceReliability,
    sourceIndependenceGroup: action.sourceIndependenceGroup ?? `deception:${deception.actionId}`,
    freshnessSeconds: deception.freshnessSeconds,
    sourceType: action.sourceType ?? 'deception',
    observation: compromised
      ? `计策回报：${action.observation ?? action.name ?? '敌军传来一则未经证实的消息'} 但行迹已暴露，可信度下降。`
      : action.observation ?? action.name ?? '敌军传来一则未经证实的消息',
    reliabilityScoreOverride: sourceReliabilityScore(world, {
      side: deception.side,
      sourceId: action.sourceId ?? null,
      sourceReliability,
    }),
  };
}

function applyDeceptionExposure(next, strategyAction, deception) {
  const penalty = deception.failureReliabilityPenalty;
  const loss = recordStrategyReliabilityLoss(next, deception.side, penalty);
  strategyAction.status = 'exposed';
  strategyAction.exposedAt = next.simTime;
  deception.status = 'exposed';
  deception.exposedAt = next.simTime;
  deception.failureReason = 'counter_intelligence_detected';
  appendBattleEvent(next, {
    type: 'strategy_reliability_reduced',
    side: deception.side,
    actionId: strategyAction.id,
    previousReliability: loss.previous,
    reliability: loss.current,
    penalty,
    reason: 'deception_exposed',
  });
  appendBattleEvent(next, {
    type: 'deception_exposed',
    side: deception.side,
    deceptionId: deception.id,
    actionId: deception.actionId,
    targetSide: deception.targetSide,
    reason: 'counter_intelligence_detected',
  });
  return next;
}

function dispatchPreparedDeception(next, strategyAction, deception, action) {
  const compromised = exposureTriggered(next, strategyAction, 'deception-dispatch');
  if (compromised) return { world: applyDeceptionExposure(next, strategyAction, deception), observation: null, error: null, errorCode: null, errorDetails: {} };

  const observationResult = queueObservation(next, queueOptionsFor(next, strategyAction, deception, action));
  if (observationResult.error || !observationResult.observation) {
    strategyAction.status = 'failed';
    strategyAction.failedAt = next.simTime;
    deception.status = 'failed';
    deception.failedAt = next.simTime;
    deception.failureReason = observationResult.errorCode ?? 'observation_queue_failed';
    return {
      world: observationResult.world,
      observation: null,
      error: observationResult.error,
      errorCode: observationResult.errorCode,
      errorDetails: observationResult.errorDetails,
    };
  }
  next = observationResult.world;
  const storedStrategyAction = next.strategy.actions.find((candidate) => candidate.id === strategyAction.id) ?? strategyAction;
  const storedDeception = next.deception.history.find((candidate) => candidate.id === deception.id) ?? deception;
  storedStrategyAction.status = 'in_transit';
  storedStrategyAction.observationId = observationResult.observation.id;
  storedStrategyAction.dispatchedAt = next.simTime;
  storedDeception.status = 'queued';
  storedDeception.observationId = observationResult.observation.id;
  storedDeception.dispatchedAt = next.simTime;
  if (storedStrategyAction.preparationSeconds > 0) {
    appendBattleEvent(next, {
      type: 'deception_dispatched',
      side: storedDeception.side,
      deceptionId: storedDeception.id,
      actionId: storedDeception.actionId,
      observationId: storedDeception.observationId,
      arrivesAt: observationResult.observation.arrivesAt,
    });
  }
  return { world: next, observation: observationResult.observation, error: null, errorCode: null, errorDetails: {} };
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

  const costError = resourceCostError(next, side, action.cost);
  if (costError) return { world: next, deception: null, ...costError };
  ensureStrategyState(next);
  const preparationSeconds = normalizeSeconds(action.preparationSeconds, BATTLEFIELD_CONFIG.defaults.observationDelaySeconds);
  const strategyAction = {
    id: nextStrategyActionId(next),
    kind: 'deception',
    side,
    actionId,
    targetSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    actualAreaId: subjectUnit.location,
    reportDelaySeconds: normalizeSeconds(delaySeconds ?? action.delaySeconds, BATTLEFIELD_CONFIG.defaults.deceptionReportDelaySeconds),
    freshnessSeconds: normalizeSeconds(freshnessSeconds ?? action.freshnessSeconds, BATTLEFIELD_CONFIG.defaults.reportFreshnessSeconds),
    confidence: confidence ?? action.confidence ?? 'medium',
    sourceId: action.sourceId ?? null,
    sourceReliability: action.sourceReliability ?? 'variable',
    sourceIndependenceGroup: action.sourceIndependenceGroup ?? `deception:${actionId}`,
    sourceType: sourceType ?? action.sourceType ?? 'deception',
    observation: observation ?? action.observation ?? action.name ?? '敌军传来一则未经证实的消息',
    preparationSeconds,
    exposureDelaySeconds: normalizeSeconds(action.exposureDelaySeconds, BATTLEFIELD_CONFIG.defaults.strategyExposureDelaySeconds),
    exposureProbability: action.exposureProbability ?? 0,
    failureReliabilityPenalty: action.failureReliabilityPenalty ?? BATTLEFIELD_CONFIG.defaults.strategyFailureReliabilityPenalty,
    cost: action.cost ?? {},
    issuedAt: next.simTime,
    readyAt: next.simTime + preparationSeconds,
    status: 'preparing',
    observationId: null,
  };
  const deception = {
    id: nextDeceptionId(next),
    schemaVersion: DECEPTION_SCHEMA_VERSION,
    side,
    actionId,
    targetSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    observationId: null,
    issuedAt: next.simTime,
    status: preparationSeconds > 0 ? 'preparing' : 'queued',
    preparationSeconds,
    readyAt: strategyAction.readyAt,
    reportDelaySeconds: strategyAction.reportDelaySeconds,
    freshnessSeconds: strategyAction.freshnessSeconds,
    confidence: strategyAction.confidence,
    exposureDelaySeconds: strategyAction.exposureDelaySeconds,
    failureReliabilityPenalty: strategyAction.failureReliabilityPenalty,
    cost: strategyAction.cost,
    exposureProbability: strategyAction.exposureProbability,
  };
  strategyAction.deceptionId = deception.id;
  spendResources(next, side, strategyAction.cost);
  registerStrategyIssue(next, side, `deception:${actionId}`);
  next.deception.lastIssuedAtBySide[`${side}:${actionId}`] = next.simTime;
  next.strategy.actions.push(strategyAction);

  if (preparationSeconds > 0) {
    next.deception.history.push(deception);
    appendBattleEvent(next, {
      type: 'deception_issued',
      side,
      deceptionId: deception.id,
      actionId,
      targetSide: recipientSide,
      targetUnitId: subjectUnitId,
      reportedAreaId: falseAreaId,
      status: deception.status,
      readyAt: deception.readyAt,
      cost: deception.cost,
    });
    return { world: next, deception, error: null, errorCode: null, errorDetails: {} };
  }

  next.deception.history.push(deception);
  const observationResult = dispatchPreparedDeception(next, strategyAction, deception, action);
  if (observationResult.error) return {
    world: observationResult.world,
    deception: null,
    error: observationResult.error,
    errorCode: observationResult.errorCode,
    errorDetails: observationResult.errorDetails,
  };
  const resultWorld = observationResult.world;
  const storedDeception = resultWorld.deception.history.find((candidate) => candidate.id === deception.id) ?? deception;
  resultWorld.deception.lastIssuedAtBySide[`${side}:${actionId}`] = resultWorld.simTime;
  appendBattleEvent(resultWorld, {
    type: 'deception_issued',
    side,
    deceptionId: storedDeception.id,
    actionId,
    targetSide: recipientSide,
    targetUnitId: subjectUnitId,
    reportedAreaId: falseAreaId,
    observationId: storedDeception.observationId,
    status: storedDeception.status,
  });
  return { world: resultWorld, deception: storedDeception, error: null, errorCode: null, errorDetails: {} };
}

/** Resolve deception actions whose preparation window has elapsed. */
export function resolvePendingDeceptions(world) {
  let next = cloneBattleWorld(world);
  const actionIds = (next.strategy?.actions ?? [])
    .filter((action) => action.kind === 'deception' && action.status === 'preparing' && action.readyAt <= next.simTime)
    .map((action) => action.id);
  actionIds.forEach((actionId) => {
    const strategyAction = next.strategy.actions.find((candidate) => candidate.id === actionId);
    if (!strategyAction) return;
    const deception = next.deception.history.find((candidate) => candidate.id === strategyAction.deceptionId);
    const action = actionFor(next, strategyAction.actionId);
    if (!deception || !action) return;
    strategyAction.status = 'ready';
    strategyAction.preparedAt = next.simTime;
    appendBattleEvent(next, {
      type: 'deception_prepared',
      side: deception.side,
      deceptionId: deception.id,
      actionId: deception.actionId,
      readyAt: next.simTime,
    });
    next = dispatchPreparedDeception(next, strategyAction, deception, action).world;
  });
  return next;
}
