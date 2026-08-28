import { applyObservation, queueObservation } from './perception.js';
import { resolveCombat } from './combat.js';
import { consumeLogistics } from './logistics.js';
import { expireBeliefs, resolveReconnaissanceActions, syncStrategyActions } from './reconnaissance.js';
import { runEnemyDecision } from './enemyAi.js';
import { resolvePendingDeceptions } from './deception.js';
import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { evaluateBattleOutcome } from './resolution.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { decideOfficerOrder, recordOfficerDecision } from './officerAi.js';
import { applyOrderRoute } from './orders.js';

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

function routeSegmentPayload(order, unit, segment, segmentIndex) {
  return {
    orderId: order.id,
    unitId: order.unitId,
    side: unit?.side,
    routeId: segment.routeId ?? null,
    routeSegmentIndex: segmentIndex,
    fromAreaId: segment.fromAreaId,
    toAreaId: segment.toAreaId,
    roadType: segment.roadType ?? null,
    grade: segment.grade ?? null,
    surface: segment.surface ?? null,
  };
}

function advanceRouteSegments(next, order, unit, currentElapsed) {
  const segments = order.routeSegments ?? [];
  if (!unit || segments.length === 0 || order.totalTravelSeconds <= 0) return;
  if (order.departedAt == null) {
    order.departedAt = next.simTime;
    appendBattleEvent(next, {
      type: 'unit_departed',
      orderId: order.id,
      unitId: order.unitId,
      side: unit.side,
      areaId: order.originAreaId,
      targetAreaId: order.targetAreaId,
    });
  }
  let elapsedBeforeSegment = 0;
  segments.forEach((segment, segmentIndex) => {
    const segmentSeconds = Math.max(0, segment.travelSeconds ?? 0);
    const segmentEnd = elapsedBeforeSegment + segmentSeconds;
    if (segment.status == null) segment.status = 'upcoming';
    if (segment.status === 'upcoming' && currentElapsed > 0 && currentElapsed >= elapsedBeforeSegment) {
      segment.status = 'active';
      segment.enteredAt = next.simTime;
      order.currentRouteSegmentIndex = segmentIndex;
      appendBattleEvent(next, { type: 'route_segment_entered', ...routeSegmentPayload(order, unit, segment, segmentIndex) });
    }
    if (segment.status === 'active' && currentElapsed >= segmentEnd) {
      segment.status = 'completed';
      segment.completedAt = next.simTime;
      unit.location = segment.toAreaId;
      appendBattleEvent(next, { type: 'route_segment_completed', ...routeSegmentPayload(order, unit, segment, segmentIndex) });
      appendBattleEvent(next, {
        type: 'unit_reached_waypoint',
        orderId: order.id,
        unitId: order.unitId,
        side: unit.side,
        areaId: segment.toAreaId,
        final: segmentIndex === segments.length - 1,
      });
      if (segment.roadType === 'pass-road') {
        appendBattleEvent(next, {
          type: 'unit_passed_pass',
          orderId: order.id,
          unitId: order.unitId,
          side: unit.side,
          areaId: segment.toAreaId,
          routeId: segment.routeId ?? null,
        });
      }
    }
    elapsedBeforeSegment = segmentEnd;
  });
  const activeIndex = segments.findIndex((segment) => segment.status === 'active');
  order.currentRouteSegmentIndex = activeIndex >= 0 ? activeIndex : null;
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
    if (order.messenger) {
      order.messenger.status = 'delivered';
      order.messenger.deliveredAt = next.simTime;
    }
    const unit = next.units[order.unitId];
    if (unit) unit.currentOrderId = order.id;
    appendBattleEvent(next, { type: 'order_delivered', orderId: order.id, unitId: order.unitId, side: unit?.side });
    if (order.recipientCommanderId) {
      appendBattleEvent(next, {
        type: 'command_delivered',
        orderId: order.id,
        side: unit?.side,
        issuerCommanderId: order.issuedByCommanderId,
        recipientCommanderId: order.recipientCommanderId,
        communicationMode: order.communicationMode,
        messenger: order.messenger,
      });
      const officerDecision = decideOfficerOrder(next, order);
      if (officerDecision) {
        recordOfficerDecision(next, order, officerDecision);
        order.executionRate = Math.max(0.1, Number(officerDecision.executionRate ?? 1));
        order.tacticalPosture = officerDecision.tacticalPosture ?? null;
        if (unit && order.tacticalPosture && order.type === 'move') unit.posture = order.tacticalPosture;
        if (officerDecision.decision === 'refused') {
          order.status = 'refused';
          order.refusedAt = next.simTime;
          order.refusalReason = officerDecision.reasonCode;
          if (unit) unit.currentOrderId = null;
        } else {
          if (officerDecision.routeAdjustment?.decision === 'reroute') {
            const routeAdjustment = officerDecision.routeAdjustment;
            applyOrderRoute(order, {
              areaIds: routeAdjustment.selectedRoute,
              travelSeconds: routeAdjustment.selectedTravelSeconds,
              segments: routeAdjustment.selectedRouteSegments,
            });
            appendBattleEvent(next, {
              type: 'officer_route_changed',
              side: unit?.side,
              orderId: order.id,
              unitId: order.unitId,
              officerId: order.recipientCommanderId,
              originalRoute: routeAdjustment.originalRoute,
              selectedRoute: order.route,
              originalTravelSeconds: routeAdjustment.originalTravelSeconds,
              selectedTravelSeconds: order.totalTravelSeconds,
              selectedTerrainTypes: routeAdjustment.selectedTerrainTypes,
              rationale: officerDecision.rationale,
            });
          }
          if (officerDecision.executionDelaySeconds > 0) {
            order.executionResumeAt = next.simTime + officerDecision.executionDelaySeconds;
          }
        }
      }
    }
  }

  for (const order of next.orders) {
    if (order.status !== 'executing') continue;
    if (order.executionResumeAt != null && order.executionResumeAt > next.simTime) continue;
    if (order.executionResumeAt != null && order.executionResumeAt <= next.simTime) {
      order.executionResumeAt = null;
      appendBattleEvent(next, {
        type: 'officer_delay_completed',
        side: next.units[order.unitId]?.side,
        orderId: order.id,
        unitId: order.unitId,
        officerId: order.recipientCommanderId,
        officerName: next.commandChain?.commanders?.[order.recipientCommanderId]?.name ?? null,
      });
    }
    if (order.type === 'hold') {
      order.taskStatus = 'active';
      order.status = 'completed';
      order.completedAt = next.simTime;
      if (next.units[order.unitId]) {
        next.units[order.unitId].currentOrderId = null;
        next.units[order.unitId].posture = 'hold';
      }
      appendBattleEvent(next, { type: 'order_completed', orderId: order.id, unitId: order.unitId, side: next.units[order.unitId]?.side, outcome: 'held' });
      appendBattleEvent(next, { type: 'unit_encamped', orderId: order.id, unitId: order.unitId, side: next.units[order.unitId]?.side, areaId: next.units[order.unitId]?.location, posture: 'hold' });
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
        routeSegmentIndex: order.currentRouteSegmentIndex ?? 0,
        routeId: order.routeSegments?.[order.currentRouteSegmentIndex ?? 0]?.routeId ?? null,
      });
      continue;
    }
    const previousElapsed = Math.max(0, order.totalTravelSeconds - order.remainingTravelSeconds);
    order.remainingTravelSeconds = Math.max(0, order.remainingTravelSeconds - Math.max(0.1, Number(order.executionRate ?? 1)));
    const currentElapsed = Math.max(0, order.totalTravelSeconds - order.remainingTravelSeconds);
    advanceRouteSegments(next, order, movingUnit, currentElapsed);
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

  next = resolveReconnaissanceActions(next);
  next = resolvePendingDeceptions(next);
  const dueObservations = next.observations.filter((observation) => observation.status === 'in_transit' && observation.arrivesAt <= next.simTime);
  for (const observation of dueObservations) next = applyObservation(next, observation).world;
  next = syncStrategyActions(next);
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
