import { appendBattleEvent, cloneBattleWorld } from './world.js';
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
  strategyCooldownRemaining,
} from './strategy.js';
import { queueObservation } from './perception.js';

export const DEFAULT_REPORT_FRESHNESS_SECONDS = BATTLEFIELD_CONFIG.defaults.reportFreshnessSeconds;

export function expireBeliefs(world) {
  const next = cloneBattleWorld(world);
  Object.values(next.beliefs ?? {}).forEach((belief) => {
    belief.reports ??= [];
    belief.reports.forEach((report) => {
      if (report.status === 'expired' || report.expiresAt == null || report.expiresAt > next.simTime) return;
      report.status = 'expired';
      report.expiredAt = next.simTime;
      if (belief.sightings[report.targetUnitId]?.id === report.id) delete belief.sightings[report.targetUnitId];
      appendBattleEvent(next, {
        type: 'report_expired',
        observerSide: belief.side,
        reportId: report.id,
        targetUnitId: report.targetUnitId,
        areaId: report.areaId,
      });
    });
  });
  return next;
}

function normalizeSeconds(value, fallback = 0) {
  return Math.max(0, Math.floor(Number(value ?? fallback) || 0));
}

function appendReliabilityLoss(next, { side, actionId, penalty, reason }) {
  const loss = recordStrategyReliabilityLoss(next, side, penalty);
  appendBattleEvent(next, {
    type: 'strategy_reliability_reduced',
    side,
    actionId,
    previousReliability: loss.previous,
    reliability: loss.current,
    penalty,
    reason,
  });
  return loss;
}

function preparedScoutOptions(world, action) {
  const compromised = exposureTriggered(world, action, 'scout-dispatch');
  let confidence = action.confidence;
  let sourceReliability = action.sourceReliability;
  let reliabilityScoreOverride = sourceReliabilityScore(world, {
    side: action.side,
    sourceId: action.sourceId,
    sourceReliability: action.sourceReliability,
  });
  let observation = action.observation;
  let delaySeconds = action.reportDelaySeconds;
  if (compromised) {
    const penalty = action.failureReliabilityPenalty;
    appendReliabilityLoss(world, {
      side: action.side,
      actionId: action.id,
      penalty,
      reason: 'reconnaissance_exposed',
    });
    confidence = 'low';
    sourceReliability = 'low';
    reliabilityScoreOverride = sourceReliabilityScore(world, {
      side: action.side,
      sourceId: action.sourceId,
      sourceReliability: 'low',
    });
    delaySeconds += action.exposureDelaySeconds;
    observation = `斥候回报：${action.observation} 但斥候行迹已暴露，情报可信度下降。`;
    action.exposureStatus = 'compromised';
    appendBattleEvent(world, {
      type: 'reconnaissance_exposed',
      side: action.side,
      actionId: action.id,
      targetUnitId: action.targetUnitId,
      reason: 'scout_spotted_before_report',
    });
  } else {
    action.exposureStatus = 'undetected';
  }
  return {
    observerSide: action.side,
    targetUnitId: action.targetUnitId,
    reportedAreaId: action.reportedAreaId,
    actualAreaId: action.actualAreaId,
    delaySeconds,
    confidence,
    sourceId: action.sourceId,
    sourceReliability,
    sourceIndependenceGroup: action.sourceIndependenceGroup,
    freshnessSeconds: action.freshnessSeconds,
    sourceType: action.sourceType,
    observation,
    reliabilityScoreOverride,
  };
}

function dispatchPreparedScout(next, action) {
  const result = queueObservation(next, preparedScoutOptions(next, action));
  if (result.error || !result.observation) {
    action.status = 'failed';
    action.failedAt = next.simTime;
    action.failureReason = result.errorCode ?? 'observation_queue_failed';
    return { world: result.world, observation: null, action, ...result };
  }
  const worldWithObservation = result.world;
  const storedAction = worldWithObservation.strategy.actions.find((candidate) => candidate.id === action.id) ?? action;
  storedAction.status = 'in_transit';
  storedAction.observationId = result.observation.id;
  storedAction.dispatchedAt = worldWithObservation.simTime;
  appendBattleEvent(worldWithObservation, {
    type: 'reconnaissance_dispatched',
    side: storedAction.side,
    actionId: storedAction.id,
    observationId: storedAction.observationId,
    status: storedAction.exposureStatus,
    arrivesAt: result.observation.arrivesAt,
  });
  return { world: worldWithObservation, observation: result.observation, action: storedAction, error: null, errorCode: null, errorDetails: {} };
}

/**
 * Spend scenario-defined reconnaissance resources and dispatch a scout.
 * Preparation is represented as a strategy action so the commander can see
 * the operation before its report enters the delayed observation queue.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').QueueObservationOptions & { cost?: Record<string, number>, preparationSeconds?: number, cooldownSeconds?: number, exposureProbability?: number, exposureDelaySeconds?: number, failureReliabilityPenalty?: number, commandContext?: Record<string, unknown> | null }} [options]
 */
export function dispatchReconnaissance(world, options = /** @type {any} */ ({})) {
  const next = cloneBattleWorld(world);
  const side = String(options.observerSide ?? 'player');
  if (!next.beliefs[side]) return { world: next, observation: null, action: null, ...battleError(BATTLE_ERROR_CODES.OBSERVER_SIDE_NOT_FOUND, '观察者阵营不存在。', { observerSide: side }) };
  if (!next.units[options.targetUnitId]) return { world: next, observation: null, action: null, ...battleError(BATTLE_ERROR_CODES.OBSERVATION_TARGET_NOT_FOUND, '观察目标部队不存在。', { targetUnitId: options.targetUnitId }) };
  if (!next.areas[options.reportedAreaId]) return { world: next, observation: null, action: null, ...battleError(BATTLE_ERROR_CODES.AREA_NOT_FOUND, '报告区域不存在。', { areaId: options.reportedAreaId }) };

  ensureStrategyState(next);
  const cooldownSeconds = normalizeSeconds(options.cooldownSeconds, BATTLEFIELD_CONFIG.defaults.scoutCooldownSeconds);
  const remainingCooldown = strategyCooldownRemaining(next, side, 'scout', cooldownSeconds);
  if (remainingCooldown > 0) {
    return { world: next, observation: null, action: null, ...battleError(BATTLE_ERROR_CODES.RECONNAISSANCE_COOLDOWN, `侦察队仍在整备，还需 ${remainingCooldown} 秒。`, { remainingSeconds: remainingCooldown }) };
  }
  const costError = resourceCostError(next, side, options.cost);
  if (costError) return { world: next, observation: null, action: null, ...costError };

  const preparationSeconds = normalizeSeconds(options.preparationSeconds, BATTLEFIELD_CONFIG.defaults.observationDelaySeconds);
  const commandContext = /** @type {Record<string, any> | null} */ (options.commandContext ?? null);
  const commandPath = Array.isArray(commandContext?.commandPath) ? commandContext.commandPath.filter(Boolean).map(String) : [];
  const commandDelaySeconds = normalizeSeconds(commandContext?.delaySeconds, 0);
  const commandDeliveredAt = next.simTime + commandDelaySeconds;
  const action = {
    id: nextStrategyActionId(next),
    kind: 'scout',
    side,
    targetUnitId: options.targetUnitId,
    reportedAreaId: options.reportedAreaId,
    actualAreaId: options.actualAreaId ?? next.units[options.targetUnitId].location,
    sourceId: options.sourceId ?? null,
    sourceReliability: options.sourceReliability ?? null,
    sourceIndependenceGroup: options.sourceIndependenceGroup ?? null,
    sourceType: options.sourceType ?? 'scout',
    observation: options.observation ?? '发现目标活动迹象',
    confidence: options.confidence ?? 'medium',
    freshnessSeconds: normalizeSeconds(options.freshnessSeconds, BATTLEFIELD_CONFIG.defaults.reportFreshnessSeconds),
    reportDelaySeconds: normalizeSeconds(options.delaySeconds, BATTLEFIELD_CONFIG.defaults.observationDelaySeconds),
    preparationSeconds,
    exposureDelaySeconds: normalizeSeconds(options.exposureDelaySeconds, BATTLEFIELD_CONFIG.defaults.strategyExposureDelaySeconds),
    exposureProbability: options.exposureProbability ?? 0,
    failureReliabilityPenalty: options.failureReliabilityPenalty ?? BATTLEFIELD_CONFIG.defaults.strategyFailureReliabilityPenalty,
    cost: options.cost ?? {},
    issuedAt: next.simTime,
    issuedByCommanderId: commandContext?.issuerCommanderId ?? null,
    recipientCommanderId: commandContext?.recipientCommanderId ?? null,
    communicationMode: commandContext?.communicationMode ?? 'legacy',
    commandPath,
    messenger: commandContext?.messenger ? JSON.parse(JSON.stringify(commandContext.messenger)) : null,
    commandDeliveredAt,
    readyAt: commandDeliveredAt + preparationSeconds,
    status: commandDelaySeconds > 0 ? 'transmitting' : 'preparing',
    observationId: null,
  };
  spendResources(next, side, action.cost);
  registerStrategyIssue(next, side, 'scout');
  next.strategy.actions.push(action);

  if (action.preparationSeconds > 0 || commandDelaySeconds > 0) {
    appendBattleEvent(next, {
      type: 'reconnaissance_issued',
      side,
      actionId: action.id,
      targetUnitId: action.targetUnitId,
      status: action.status,
      readyAt: action.readyAt,
      commandDeliveredAt: action.commandDeliveredAt,
      communicationMode: action.communicationMode,
      cost: action.cost,
    });
    return { world: next, observation: null, action, error: null, errorCode: null, errorDetails: {} };
  }

  return dispatchPreparedScout(next, action);
}

/** Resolve prepared scout actions in the realtime clock. */
export function resolveReconnaissanceActions(world) {
  let next = cloneBattleWorld(world);
  const transmittingIds = (next.strategy?.actions ?? [])
    .filter((action) => action.kind === 'scout' && action.status === 'transmitting' && action.commandDeliveredAt <= next.simTime)
    .map((action) => action.id);
  transmittingIds.forEach((actionId) => {
    const action = next.strategy.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    action.commandDeliveredAt = next.simTime;
    if (action.messenger) {
      action.messenger.status = 'delivered';
      action.messenger.deliveredAt = next.simTime;
    }
    action.status = action.preparationSeconds > 0 ? 'preparing' : 'ready';
    appendBattleEvent(next, {
      type: 'reconnaissance_command_delivered',
      side: action.side,
      actionId,
      recipientCommanderId: action.recipientCommanderId,
      communicationMode: action.communicationMode,
    });
    if (action.preparationSeconds === 0) {
      const result = dispatchPreparedScout(next, action);
      next = result.world;
    }
  });
  const actionIds = (next.strategy?.actions ?? [])
    .filter((action) => action.kind === 'scout' && action.status === 'preparing' && action.readyAt <= next.simTime)
    .map((action) => action.id);
  actionIds.forEach((actionId) => {
    const action = next.strategy.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    action.status = 'ready';
    action.preparedAt = next.simTime;
    appendBattleEvent(next, { type: 'reconnaissance_prepared', side: action.side, actionId, readyAt: next.simTime });
    const result = dispatchPreparedScout(next, action);
    next = result.world;
  });
  return next;
}

/** Keep strategy action cards synchronized with their delayed observations. */
export function syncStrategyActions(world) {
  const next = cloneBattleWorld(world);
  (next.strategy?.actions ?? []).forEach((action) => {
    if (!action.observationId || ['failed', 'exposed'].includes(action.status)) return;
    const observation = next.observations.find((candidate) => candidate.id === action.observationId);
    if (!observation) return;
    if (observation.status === 'delivered') {
      action.status = 'delivered';
      action.deliveredAt = observation.deliveredAt ?? next.simTime;
    }
  });
  return next;
}
