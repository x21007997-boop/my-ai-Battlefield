import { buildCommanderMapModel } from './projection.js';
import { serializeCommanderEvents } from './eventProtocol.js';
import { buildCommanderObjectiveSnapshot, buildCommanderReview } from './review.js';
import { buildCommanderResolutionSnapshot } from './resolution.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { commanderProjection, playerCommanderId } from './commandChain.js';
import { buildHistoricalEstimate, formatHistoricalDuration, formatHistoricalTime, projectHistoricalTime } from './calendar.js';
import { buildArrivalWindow, routeDistanceEstimate, sanitizeRouteSegment } from './commanderEstimate.js';

export const COMMANDER_SESSION_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.commanderSession;

const HIDDEN_EVENT_TYPES = new Set(BATTLEFIELD_CONFIG.hiddenEventTypes);

function eventVisibleToCommander(event, side) {
  if (HIDDEN_EVENT_TYPES.has(event.type)) return false;
  if (event.side && event.side !== side) return false;
  if (['observation_created', 'report_arrived', 'report_expired'].includes(event.type)) {
    return event.observerSide === side;
  }
  return true;
}

/**
 * Build the commander-facing projection; raw enemy units never cross here.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').CommanderMapOptions} [options]
 */
export function buildCommanderSessionSnapshot(world, {
  side = 'player',
  mapAsset = null,
  mapTitle = '',
  mapNote = '',
  mapConfig = {},
  mapMarkers = [],
  terrainFeatures = [],
} = {}) {
  const map = buildCommanderMapModel(world, { side, mapAsset, mapTitle, mapNote, mapConfig, mapMarkers, terrainFeatures });
  const ownOrders = world.orders
    .filter((order) => world.units[order.unitId]?.side === side)
    .map((order) => ({
      id: order.id,
      type: order.type,
      taskType: order.taskType ?? null,
      taskLabel: order.taskLabel ?? null,
      unitId: order.unitId,
      targetAreaId: order.targetAreaId,
      originAreaId: order.originAreaId ?? null,
      status: order.status,
      issuedAt: order.issuedAt,
      deliveredAt: order.deliveredAt ?? null,
      completedAt: order.completedAt ?? null,
      route: [...(order.route ?? [])],
      routeSegments: (order.routeSegments ?? []).map(sanitizeRouteSegment),
      terrainTransitions: JSON.parse(JSON.stringify(order.terrainTransitions ?? [])),
      distanceEstimate: routeDistanceEstimate(order.routeSegments ?? []),
      movementProgress: order.movementProgress ?? 0,
      currentTerrain: order.currentTerrain ?? null,
      lastTerrainTransition: order.lastTerrainTransition ?? null,
      rawText: order.rawText ?? '',
      issuedByCommanderId: order.issuedByCommanderId ?? null,
      recipientCommanderId: order.recipientCommanderId ?? null,
      communicationMode: order.communicationMode ?? 'legacy',
      commandPath: [...(order.commandPath ?? [])],
      messenger: order.messenger ? JSON.parse(JSON.stringify(order.messenger)) : null,
      taskStatus: order.taskStatus ?? null,
      blockedAt: order.blockedAt ?? null,
      blockReason: order.blockReason ?? null,
      officerDecision: order.officerDecision ? JSON.parse(JSON.stringify(order.officerDecision)) : null,
      officerFeedback: order.officerFeedback ?? null,
      officerWaiting: order.executionResumeAt != null && order.executionResumeAt > world.simTime,
      executionPace: order.executionPace ?? null,
      executionRate: order.executionRate ?? 1,
      tacticalPosture: order.tacticalPosture ?? null,
      deliveryEstimate: buildArrivalWindow(world.calendar, world.simTime, Math.max(0, order.deliverAt - world.simTime), 0.2),
      movementEstimate: buildArrivalWindow(
        world.calendar,
        world.simTime,
        Math.ceil((order.remainingTravelSeconds ?? 0) / Math.max(0.1, Number(order.executionRate ?? 1))),
        Math.max(0.2, ...(order.routeSegments ?? []).map((segment) => Number(segment.distanceUncertainty ?? 0.25))),
      ),
    }));
  const ownObservations = world.observations
    .filter((observation) => observation.observerSide === side)
    .map((observation) => ({
      id: observation.id,
      status: observation.status,
      sourceType: observation.sourceType,
      sourceId: observation.sourceId ?? null,
      sourceIndependenceGroup: observation.sourceIndependenceGroup ?? null,
      confidence: observation.confidence ?? 'unknown',
      reportedAreaId: observation.reportedAreaId,
      observation: observation.observation ?? '',
      observedAt: observation.observedAt ?? null,
      arrivesAt: observation.arrivesAt,
      deliveredAt: observation.deliveredAt ?? null,
      remainingSeconds: Math.max(0, (observation.arrivesAt ?? world.simTime) - world.simTime),
      arrivalEstimate: buildHistoricalEstimate(world.calendar, world.simTime, observation.arrivesAt),
      uncertainty: observation.uncertainty ?? null,
    }));
  const deceptionActions = Object.values(world.deception?.actions ?? {}).map((action) => ({
    id: action.id,
    name: action.name,
    effect: action.effect,
    mode: action.mode ?? 'false-report',
    targetSide: action.targetSide ?? null,
    targetUnitId: action.targetUnitId ?? null,
    recipientCommanderId: action.recipientCommanderId ?? null,
    reportedAreaId: action.reportedAreaId ?? null,
    delaySeconds: action.delaySeconds ?? 0,
    freshnessSeconds: action.freshnessSeconds ?? null,
    confidence: action.confidence ?? 'medium',
    cooldownSeconds: action.cooldownSeconds ?? BATTLEFIELD_CONFIG.defaults.deceptionCooldownSeconds,
    preparationSeconds: action.preparationSeconds ?? 0,
    cost: action.cost ?? {},
    exposureProbability: action.exposureProbability ?? 0,
    failureReliabilityPenalty: action.failureReliabilityPenalty ?? BATTLEFIELD_CONFIG.defaults.strategyFailureReliabilityPenalty,
    status: action.status ?? 'simulation-action-candidate',
    evidenceGrade: action.evidenceGrade ?? null,
  }));
  const deceptionHistory = (world.deception?.history ?? [])
    .filter((item) => item.side === side)
    .map((item) => ({
      id: item.id,
      schemaVersion: item.schemaVersion,
      side: item.side,
      actionId: item.actionId,
      targetSide: item.targetSide,
      targetUnitId: item.targetUnitId,
      reportedAreaId: item.reportedAreaId,
      observationId: item.observationId ?? null,
      issuedAt: item.issuedAt,
      readyAt: item.readyAt ?? null,
      preparationSeconds: item.preparationSeconds ?? 0,
      status: item.status,
      exposedAt: item.exposedAt ?? null,
      failedAt: item.failedAt ?? null,
      failureReason: item.failureReason ?? null,
      cost: item.cost ?? {},
      exposureProbability: item.exposureProbability ?? 0,
      issuedByCommanderId: item.issuedByCommanderId ?? null,
      recipientCommanderId: item.recipientCommanderId ?? null,
      communicationMode: item.communicationMode ?? 'legacy',
      commandPath: Array.isArray(item.commandPath) ? item.commandPath.filter(Boolean).map(String) : [],
      commandDeliveredAt: item.commandDeliveredAt ?? null,
      commandUnitId: item.commandUnitId ?? null,
      officerDecision: item.officerDecision ? JSON.parse(JSON.stringify(item.officerDecision)) : null,
      officerFeedback: item.officerFeedback ?? null,
      executionDelaySeconds: item.executionDelaySeconds ?? 0,
      executionPace: item.executionPace ?? null,
      executionRate: item.executionRate ?? 1,
      tacticalPosture: item.tacticalPosture ?? null,
    }));
  const strategyActions = (world.strategy?.actions ?? [])
    .filter((action) => action.side === side)
    .map((rawAction) => {
      const action = /** @type {import('./contracts').StrategyAction} */ (rawAction);
      return ({
        id: action.id,
        kind: action.kind,
        actionId: action.actionId ?? null,
        side: action.side,
        targetSide: action.targetSide ?? null,
        targetUnitId: action.targetUnitId,
        reportedAreaId: action.reportedAreaId ?? null,
        status: action.status,
        issuedAt: action.issuedAt,
        readyAt: action.readyAt,
        preparedAt: action.preparedAt ?? null,
        dispatchedAt: action.dispatchedAt ?? null,
        deliveredAt: action.deliveredAt ?? null,
        observationId: action.observationId ?? null,
        exposureStatus: action.exposureStatus ?? null,
        failedAt: action.failedAt ?? null,
        failureReason: action.failureReason ?? null,
        cost: action.cost ?? {},
        issuedByCommanderId: action.issuedByCommanderId ?? null,
        recipientCommanderId: action.recipientCommanderId ?? null,
        communicationMode: action.communicationMode ?? 'legacy',
        commandPath: Array.isArray(action.commandPath) ? action.commandPath.filter(Boolean).map(String) : [],
        messenger: action.messenger ? JSON.parse(JSON.stringify(action.messenger)) : null,
        commandDeliveredAt: action.commandDeliveredAt ?? null,
        commandUnitId: action.commandUnitId ?? null,
        officerDecision: action.officerDecision ? JSON.parse(JSON.stringify(action.officerDecision)) : null,
        officerFeedback: action.officerFeedback ?? null,
        executionDelaySeconds: action.executionDelaySeconds ?? 0,
        executionPace: action.executionPace ?? null,
        executionRate: action.executionRate ?? 1,
        tacticalPosture: action.tacticalPosture ?? null,
        readyEstimate: buildHistoricalEstimate(world.calendar, world.simTime, action.readyAt),
      });
    });
  const eventLog = serializeCommanderEvents(
    world.eventLog.filter((event) => eventVisibleToCommander(event, side)),
  ).map((event) => ({
    ...event,
    historicalTimeLabel: formatHistoricalTime(world.calendar, event.simTime),
  }));

  return {
    schemaVersion: COMMANDER_SESSION_SCHEMA_VERSION,
    scenarioId: world.scenarioId,
    simTime: world.simTime,
    historicalTime: world.calendar ? {
      label: formatHistoricalTime(world.calendar, world.simTime),
      ...projectHistoricalTime(world.calendar, world.simTime),
      calendarStatus: world.calendar.status,
      elapsedLabel: formatHistoricalDuration(world.calendar, world.simTime),
    } : null,
    status: world.status,
    outcome: world.outcome ?? null,
    objectives: buildCommanderObjectiveSnapshot(world, side),
    review: world.outcome ? buildCommanderReview(world, { side }) : null,
    resolution: buildCommanderResolutionSnapshot(world, side),
    map,
    ownOrders,
    ownObservations,
    deceptionActions,
    deceptionHistory,
    resources: JSON.parse(JSON.stringify(world.resources?.[side] ?? {})),
    strategyActions,
    commanders: commanderProjection(world, side),
    playerCommanderId: playerCommanderId(world, side),
    commandChain: world.commandChain ? {
      schemaVersion: world.commandChain.schemaVersion,
      playerCommanderIdsBySide: { [side]: playerCommanderId(world, side) },
      messengerPolicy: JSON.parse(JSON.stringify(world.commandChain.messengerPolicy ?? {})),
    } : null,
    strategyReliability: world.strategy?.reliabilityBySide?.[side] ?? 1,
    eventLog,
    disclosure: {
      side,
      rawEnemyUnitsIncluded: false,
      combatTruthIncluded: false,
      actualEnemyPositionsIncluded: false,
      source: 'headless-battlefield-core',
    },
  };
}
