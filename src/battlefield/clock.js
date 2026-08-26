import { applyObservation, queueObservation } from './perception.js';
import { resolveCombat } from './combat.js';
import { consumeLogistics } from './logistics.js';
import { expireBeliefs } from './reconnaissance.js';
import { runEnemyDecision } from './enemyAi.js';
import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { evaluateBattleOutcome } from './resolution.js';
import { BATTLEFIELD_CONFIG } from './config.js';

const TERRAIN_LABELS = BATTLEFIELD_CONFIG.terrainLabels;

function terrainEventPayload(order, unit, transition, status) {
  return {
    orderId: order.id,
    unitId: order.unitId,
    side: unit?.side,
    featureId: transition.featureId,
    terrainType: transition.terrainType,
    transitionType: transition.transitionType ?? `${transition.terrainType}-crossing`,
    label: transition.label ?? TERRAIN_LABELS[transition.terrainType] ?? '地形通过',
    method: transition.method ?? null,
    effects: transition.effects ?? {},
    effectsApplied: transition.effectsApplied ?? {},
    routeSegmentIndex: transition.segmentIndex ?? null,
    progress: status === 'entered' ? transition.startProgress : transition.endProgress,
  };
}

function applyTerrainEffects(next, order, unit, previousElapsed, currentElapsed) {
  if (!unit) return;
  (order.terrainTransitions ?? [])
    .forEach((transition) => {
      const effects = transition.effects ?? {};
      const fatigue = Number(effects.fatiguePerSecond ?? 0);
      const supply = Number(effects.supplyDaysPerSecond ?? 0);
      const readiness = Number(effects.readinessLossPerSecond ?? 0);
      const affectedSeconds = Math.max(0, Math.min(currentElapsed, transition.endTravelSeconds) - Math.max(previousElapsed, transition.startTravelSeconds));
      if (affectedSeconds <= 0) return;
      unit.fatigue = Math.min(100, unit.fatigue + fatigue * affectedSeconds);
      unit.supplyDays = Math.max(0, unit.supplyDays - supply * affectedSeconds);
      unit.readiness = Math.max(0, unit.readiness - readiness * affectedSeconds);
      transition.effectSeconds = (transition.effectSeconds ?? 0) + affectedSeconds;
      transition.effectsApplied = {
        fatigue: (transition.effectsApplied?.fatigue ?? 0) + fatigue * affectedSeconds,
        supplyDays: (transition.effectsApplied?.supplyDays ?? 0) + supply * affectedSeconds,
        readiness: (transition.effectsApplied?.readiness ?? 0) + readiness * affectedSeconds,
      };
      // The commander-facing summary is copied when the unit exits the
      // terrain, before this tick's effects are applied. Keep it synchronized
      // with the authoritative transition record.
      if (
        transition.status === 'crossed'
        && order.lastTerrainTransition
        && order.lastTerrainTransition.featureId === transition.featureId
      ) {
        order.lastTerrainTransition.effectsApplied = transition.effectsApplied ?? {};
      }
    });
}

function advanceTerrainTransitions(next, order, unit, currentElapsed) {
  const transitions = order.terrainTransitions ?? [];
  for (const transition of transitions) {
    if (transition.status === 'upcoming' && currentElapsed >= transition.startTravelSeconds) {
      transition.status = 'crossing';
      order.currentTerrain = {
        featureId: transition.featureId,
        terrainType: transition.terrainType,
        label: transition.label ?? TERRAIN_LABELS[transition.terrainType] ?? '地形通过',
        method: transition.method ?? null,
      };
      appendBattleEvent(next, { type: 'unit_entered_terrain', ...terrainEventPayload(order, unit, transition, 'entered') });
    }
    if (transition.status === 'crossing' && currentElapsed >= transition.endTravelSeconds) {
      transition.status = 'crossed';
      transition.crossedAt = next.simTime;
      order.lastTerrainTransition = {
        featureId: transition.featureId,
        terrainType: transition.terrainType,
        label: transition.label ?? TERRAIN_LABELS[transition.terrainType] ?? '地形通过',
        method: transition.method ?? null,
        effectsApplied: transition.effectsApplied ?? {},
        crossedAt: next.simTime,
      };
      order.currentTerrain = null;
      appendBattleEvent(next, { type: 'unit_exited_terrain', ...terrainEventPayload(order, unit, transition, 'exited') });
    }
  }
  order.movementProgress = order.totalTravelSeconds > 0
    ? Math.min(1, currentElapsed / order.totalTravelSeconds)
    : 1;
}

function opposingSide(world, side) {
  return Object.keys(world.sides ?? {}).find((candidate) => candidate !== side) ?? null;
}

function isBlockedByOpposingUnit(world, areaId, side) {
  return (world.blockades ?? []).some((blockade) => (
    blockade.status === 'active'
    && blockade.areaId === areaId
    && blockade.side !== side
    && world.units?.[blockade.unitId]?.location === blockade.areaId
    && !['destroyed', 'routed'].includes(world.units?.[blockade.unitId]?.status)
  ));
}

function applyTaskEffects(next, order, unit) {
  if (!unit || !order.taskType) return next;
  const taskType = order.taskType;
  const taskLabel = order.taskLabel ?? taskType;
  const effect = { posture: taskType };
  unit.posture = taskType;
  order.taskStatus = 'active';

  if (taskType === 'blockade') {
    next.blockades ??= [];
    next.blockades.push({
      id: `blockade-${String(next.blockades.length + 1).padStart(4, '0')}`,
      unitId: unit.id,
      side: unit.side,
      areaId: order.targetAreaId,
      startedAt: next.simTime,
      status: 'active',
    });
    effect.areaControl = 'opposing-movement-blocked';
  }

  if (taskType === 'interdict_supply') {
    next.supplyInterdictions ??= [];
    next.supplyInterdictions.push({
      id: `supply-interdiction-${String(next.supplyInterdictions.length + 1).padStart(4, '0')}`,
      unitId: unit.id,
      side: unit.side,
      areaId: order.targetAreaId,
      startedAt: next.simTime,
      status: 'active',
    });
    effect.supplyPressure = 'opposing-supply-disrupted';
  }

  if (taskType === 'decoy') {
    const recipientSide = opposingSide(next, unit.side);
    if (recipientSide && next.beliefs?.[recipientSide]) {
      const report = queueObservation(next, {
        observerSide: recipientSide,
        targetUnitId: unit.id,
        reportedAreaId: order.targetAreaId,
        actualAreaId: unit.location,
        delaySeconds: BATTLEFIELD_CONFIG.defaults.taskReportDelaySeconds,
        confidence: 'medium',
        sourceReliability: 'variable',
        sourceIndependenceGroup: `decoy:${order.id}`,
        freshnessSeconds: BATTLEFIELD_CONFIG.defaults.enemyActionReportFreshnessSeconds,
        sourceType: 'decoy-signal',
        observation: `前线来报：${unit.name}方向似有一支孤立部队，可尝试诱其出动。`,
      });
      next = report.world;
      effect.signal = report.error ? 'signal_failed' : 'decoy_signal_queued';
    }
  }

  appendBattleEvent(next, {
    type: 'task_effect_applied',
    orderId: order.id,
    unitId: unit.id,
    side: unit.side,
    taskType,
    taskLabel,
    areaId: order.targetAreaId,
    effect,
  });
  return next;
}

function advanceOneSecond(world) {
  if (world.status === 'ended') return cloneBattleWorld(world);
  let next = cloneBattleWorld(world);
  next.simTime += 1;

  for (const order of next.orders) {
    if (order.status !== 'transmitting' || order.deliverAt > next.simTime) continue;
    order.status = 'executing';
    order.deliveredAt = next.simTime;
    const unit = next.units[order.unitId];
    if (unit) unit.currentOrderId = order.id;
    appendBattleEvent(next, { type: 'order_delivered', orderId: order.id, unitId: order.unitId, side: unit?.side });
  }

  for (const order of next.orders) {
    if (order.status !== 'executing') continue;
    if (order.type === 'hold') {
      order.taskStatus = 'active';
      order.status = 'completed';
      order.completedAt = next.simTime;
      if (next.units[order.unitId]) {
        next.units[order.unitId].currentOrderId = null;
        next.units[order.unitId].posture = 'hold';
      }
      appendBattleEvent(next, { type: 'order_completed', orderId: order.id, unitId: order.unitId, side: next.units[order.unitId]?.side, outcome: 'held' });
      continue;
    }
    const movingUnit = next.units[order.unitId];
    if (movingUnit && isBlockedByOpposingUnit(next, order.targetAreaId, movingUnit.side)) {
      order.status = 'blocked';
      order.blockedAt = next.simTime;
      order.blockReason = 'opposing_blockade';
      movingUnit.currentOrderId = null;
      appendBattleEvent(next, {
        type: 'order_blocked',
        orderId: order.id,
        unitId: order.unitId,
        side: movingUnit.side,
        targetAreaId: order.targetAreaId,
        reason: 'opposing_blockade',
      });
      continue;
    }
    const previousElapsed = Math.max(0, order.totalTravelSeconds - order.remainingTravelSeconds);
    order.remainingTravelSeconds = Math.max(0, order.remainingTravelSeconds - 1);
    const currentElapsed = Math.max(0, order.totalTravelSeconds - order.remainingTravelSeconds);
    advanceTerrainTransitions(next, order, next.units[order.unitId], currentElapsed);
    applyTerrainEffects(next, order, next.units[order.unitId], previousElapsed, currentElapsed);
    if (order.remainingTravelSeconds > 0) continue;
    const unit = next.units[order.unitId];
    if (unit) {
      unit.location = order.targetAreaId;
      unit.currentOrderId = null;
    }
    order.status = 'completed';
    order.completedAt = next.simTime;
    next = applyTaskEffects(next, order, unit);
    appendBattleEvent(next, { type: 'unit_arrived', orderId: order.id, unitId: order.unitId, side: unit?.side, areaId: order.targetAreaId });
  }

  const dueObservations = next.observations.filter((observation) => observation.status === 'in_transit' && observation.arrivesAt <= next.simTime);
  for (const observation of dueObservations) next = applyObservation(next, observation).world;
  next = expireBeliefs(next);
  next = consumeLogistics(next);
  next = resolveCombat(next);
  next = runEnemyDecision(next);
  return evaluateBattleOutcome(next);
}

/**
 * Advance a cloned world in one-second simulation steps.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {number} [seconds]
 * @returns {import('./contracts').BattleWorld}
 */
export function stepBattle(world, seconds = 1) {
  const duration = Math.max(0, Math.floor(seconds));
  let next = cloneBattleWorld(world);
  for (let second = 0; second < duration; second += 1) next = advanceOneSecond(next);
  return next;
}

/**
 * Advance the battlefield with a safety cap for gateway requests.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {number} seconds
 * @param {{ maxSeconds?: number }} [options]
 * @returns {import('./contracts').BattleWorld}
 */
export function advanceBattle(world, seconds, { maxSeconds = 3600 } = {}) {
  const duration = Math.min(Math.max(0, Math.floor(seconds)), maxSeconds);
  return stepBattle(world, duration);
}
