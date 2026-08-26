import { buildCommanderMapModel } from './projection.js';
import { serializeCommanderEvents } from './eventProtocol.js';
import { buildCommanderObjectiveSnapshot, buildCommanderReview } from './review.js';
import { BATTLEFIELD_CONFIG } from './config.js';

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
      unitId: order.unitId,
      targetAreaId: order.targetAreaId,
      originAreaId: order.originAreaId ?? null,
      status: order.status,
      issuedAt: order.issuedAt,
      deliverAt: order.deliverAt,
      deliveredAt: order.deliveredAt ?? null,
      completedAt: order.completedAt ?? null,
      route: [...(order.route ?? [])],
      routeSegments: JSON.parse(JSON.stringify(order.routeSegments ?? [])),
      terrainTransitions: JSON.parse(JSON.stringify(order.terrainTransitions ?? [])),
      totalTravelSeconds: order.totalTravelSeconds ?? order.remainingTravelSeconds ?? 0,
      remainingTravelSeconds: order.remainingTravelSeconds ?? 0,
      movementProgress: order.movementProgress ?? 0,
      currentTerrain: order.currentTerrain ?? null,
      lastTerrainTransition: order.lastTerrainTransition ?? null,
      rawText: order.rawText ?? '',
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
      uncertainty: observation.uncertainty ?? null,
    }));
  const deceptionActions = Object.values(world.deception?.actions ?? {}).map((action) => ({
    id: action.id,
    name: action.name,
    effect: action.effect,
    mode: action.mode ?? 'false-report',
    targetSide: action.targetSide ?? null,
    targetUnitId: action.targetUnitId ?? null,
    reportedAreaId: action.reportedAreaId ?? null,
    delaySeconds: action.delaySeconds ?? 0,
    freshnessSeconds: action.freshnessSeconds ?? null,
    confidence: action.confidence ?? 'medium',
    cooldownSeconds: action.cooldownSeconds ?? BATTLEFIELD_CONFIG.defaults.deceptionCooldownSeconds,
    status: action.status ?? 'simulation-action-candidate',
    evidenceGrade: action.evidenceGrade ?? null,
  }));
  const deceptionHistory = (world.deception?.history ?? [])
    .filter((item) => item.side === side)
    .map((item) => ({ ...item }));
  const eventLog = serializeCommanderEvents(
    world.eventLog.filter((event) => eventVisibleToCommander(event, side)),
  );

  return {
    schemaVersion: COMMANDER_SESSION_SCHEMA_VERSION,
    scenarioId: world.scenarioId,
    simTime: world.simTime,
    status: world.status,
    outcome: world.outcome ?? null,
    objectives: buildCommanderObjectiveSnapshot(world, side),
    review: world.outcome ? buildCommanderReview(world, { side }) : null,
    map,
    ownOrders,
    ownObservations,
    deceptionActions,
    deceptionHistory,
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
