import { viewBelief } from './perception.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const BATTLEFIELD_MAP_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.map;
export const BATTLEFIELD_MAP_COORDINATE_SYSTEM = BATTLEFIELD_CONFIG.coordinateSystem;

function validPoint(position) {
  return position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { x: position.x, y: position.y }
    : null;
}

function pointAlongRoute(areaById, route, routeSegments, progress) {
  if (!Array.isArray(route) || route.length === 0) return null;
  if (route.length === 1) return validPoint(areaById[route[0]]?.position);
  const segments = Array.isArray(routeSegments) && routeSegments.length === route.length - 1
    ? routeSegments
    : route.slice(0, -1).map((fromAreaId, index) => ({
      fromAreaId,
      toAreaId: route[index + 1],
      travelSeconds: 1,
    }));
  const totalTravelSeconds = segments.reduce((total, segment) => total + Math.max(0, segment.travelSeconds ?? 0), 0);
  let remainingTravelSeconds = totalTravelSeconds * Math.min(1, Math.max(0, progress));
  for (const segment of segments) {
    const from = validPoint(areaById[segment.fromAreaId]?.position);
    const to = validPoint(areaById[segment.toAreaId]?.position);
    const segmentSeconds = Math.max(0, segment.travelSeconds ?? 0);
    if (!from || !to) continue;
    if (remainingTravelSeconds <= segmentSeconds || segment === segments[segments.length - 1]) {
      const segmentProgress = segmentSeconds > 0 ? remainingTravelSeconds / segmentSeconds : 1;
      return {
        x: from.x + (to.x - from.x) * Math.min(1, Math.max(0, segmentProgress)),
        y: from.y + (to.y - from.y) * Math.min(1, Math.max(0, segmentProgress)),
      };
    }
    remainingTravelSeconds -= segmentSeconds;
  }
  return validPoint(areaById[route[route.length - 1]]?.position);
}

function commanderAreaName(area) {
  // Historical qualification belongs in the scenario review, not on the
  // commander's working map. Keep the map label short and decision-useful.
  return String(area.name ?? area.id)
    .replaceAll(/（[^）]*）/g, '')
    .replaceAll(/\([^)]*\)/g, '')
    .trim();
}

function routeKey(from, to) {
  return [from, to].sort().join('::');
}

function buildRoutes(areas) {
  const routes = [];
  const seen = new Set();
  Object.values(areas).forEach((area) => {
    const from = validPoint(area.position);
    if (!from) return;
    (area.neighbors ?? []).forEach((neighbor) => {
      const toArea = areas[neighbor.id];
      const to = validPoint(toArea?.position);
      if (!to) return;
      const key = routeKey(area.id, neighbor.id);
      if (seen.has(key)) return;
      seen.add(key);
      routes.push({
        id: `route-${key.replaceAll('::', '-')}`,
        fromAreaId: area.id,
        toAreaId: neighbor.id,
        travelSeconds: neighbor.travelSeconds,
        routeId: neighbor.routeId ?? null,
        terrainTransitions: (neighbor.terrainTransitions ?? []).map((transition) => ({ ...transition })),
        points: [from, to],
      });
    });
  });
  return routes;
}

function buildLandmarks(areas, mapMarkers = []) {
  // Multiple strategic markers may share one simulation area (for example a
  // city and a granary inside the same battle zone). Their presentation
  // positions can be offset without changing the simulation graph.
  return mapMarkers
    .map((marker) => {
      const area = areas[marker.areaId];
      const position = validPoint(marker.position ?? area?.position);
      if (!area || !position) return null;
      return {
        ...marker,
        areaId: area.id,
        position,
        evidenceGrade: marker.evidenceGrade ?? area.evidenceGrade ?? null,
        status: marker.status ?? area.locationStatus ?? 'scenario_assumption',
      };
    })
    .filter(Boolean);
}

function normalizeReportUncertainty(sighting, areaById) {
  const uncertainty = sighting.uncertainty ?? {};
  const candidateAreaIds = (uncertainty.candidateAreaIds ?? [sighting.areaId])
    .filter((areaId) => areaById[areaId])
    .filter((areaId, index, values) => values.indexOf(areaId) === index);
  return {
    level: uncertainty.level ?? sighting.confidence ?? 'unknown',
    radiusNormalized: Number.isFinite(uncertainty.radiusNormalized) ? uncertainty.radiusNormalized : 0.2,
    candidateAreaIds: candidateAreaIds.length > 0 ? candidateAreaIds : [sighting.areaId],
    label: uncertainty.label ?? '仅供参考',
  };
}

/**
 * Project only known friendly units, landmarks and reported enemy signals.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').CommanderMapOptions} [options]
 */
export function buildCommanderMapModel(world, {
  side = 'player',
  mapAsset = null,
  mapTitle = '',
  mapNote = '',
  mapConfig = {},
  mapMarkers = [],
  terrainFeatures = [],
} = {}) {
  const belief = viewBelief(world, side);
  const areas = Object.values(world.areas).map((area) => ({
    id: area.id,
    name: commanderAreaName(area),
    terrain: area.terrain,
    position: validPoint(area.position),
    locationStatus: area.locationStatus,
    evidenceGrade: area.evidenceGrade,
    neighbors: (area.neighbors ?? []).map((neighbor) => ({
      id: neighbor.id,
      travelSeconds: neighbor.travelSeconds,
      routeId: neighbor.routeId ?? null,
      terrainTransitions: (neighbor.terrainTransitions ?? []).map((transition) => ({ ...transition })),
    })),
  }));
  const areaById = Object.fromEntries(areas.map((area) => [area.id, area]));
  const activeOrdersByUnitId = Object.fromEntries(
    world.orders
      .filter((order) => order.type !== 'hold' && ['transmitting', 'executing'].includes(order.status))
      .map((order) => [order.unitId, order]),
  );
  const friendlyUnits = belief.ownUnits
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      unitType: unit.unitType,
      areaId: unit.location,
      position: (() => {
        const activeOrder = activeOrdersByUnitId[unit.id];
        if (!activeOrder || activeOrder.status !== 'executing') return areaById[unit.location]?.position ?? null;
        return pointAlongRoute(areaById, activeOrder.route, activeOrder.routeSegments, activeOrder.movementProgress ?? 0)
          ?? areaById[unit.location]?.position
          ?? null;
      })(),
      status: unit.status,
      posture: unit.posture ?? 'standard',
      symbolType: 'friendly-flag',
      movement: (() => {
        const activeOrder = activeOrdersByUnitId[unit.id];
        if (!activeOrder) return null;
        return {
          orderId: activeOrder.id,
          status: activeOrder.status,
          progress: activeOrder.movementProgress ?? 0,
          currentTerrain: activeOrder.currentTerrain ?? null,
          lastTerrainTransition: activeOrder.lastTerrainTransition ?? null,
          officerDecision: activeOrder.officerDecision ?? null,
          officerFeedback: activeOrder.officerFeedback ?? null,
          executionResumeAt: activeOrder.executionResumeAt ?? null,
          officerWaiting: activeOrder.executionResumeAt != null && activeOrder.executionResumeAt > world.simTime,
        };
      })(),
    }))
    .filter((unit) => unit.position);
  const reportedEnemySignals = Object.values(belief.sightings ?? {})
    .filter((sighting) => sighting.status !== 'expired' && areaById[sighting.areaId]?.position)
    .map((sighting) => {
      const uncertainty = normalizeReportUncertainty(sighting, areaById);
      return {
        id: sighting.id,
        targetUnitId: sighting.targetUnitId,
        areaId: sighting.areaId,
        position: areaById[sighting.areaId].position,
        candidatePositions: uncertainty.candidateAreaIds
          .map((areaId) => areaById[areaId]?.position)
          .filter(Boolean),
        confidence: sighting.confidence,
        sourceId: sighting.sourceId,
        sourceIndependenceGroup: sighting.sourceIndependenceGroup ?? null,
        sourceType: sighting.sourceType,
        text: sighting.text ?? '',
        receivedAt: sighting.receivedAt,
        expiresAt: sighting.expiresAt,
        uncertainty,
        symbolType: 'reported-pennant',
      };
    });

  return {
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    coordinateSystem: mapConfig.coordinateSystem ?? BATTLEFIELD_MAP_COORDINATE_SYSTEM,
    bounds: mapConfig.bounds ?? BATTLEFIELD_CONFIG.mapBounds,
    backgroundAsset: mapAsset,
    renderMode: mapConfig.renderMode ?? (mapAsset ? 'texture' : 'vector-terrain'),
    terrainFeatures: terrainFeatures.length > 0
      ? terrainFeatures.map((feature) => ({
        id: feature.id,
        type: feature.type,
        name: feature.name,
        points: (feature.points ?? []).map(validPoint).filter(Boolean),
        width: feature.width ?? null,
        status: feature.status ?? 'scenario_assumption',
        evidenceGrade: feature.evidenceGrade ?? null,
      }))
      : (world.terrainFeatures ?? []).map((feature) => ({
        id: feature.id,
        type: feature.type,
        name: feature.name,
        points: (feature.points ?? []).map(validPoint).filter(Boolean),
        width: feature.width ?? null,
        status: feature.status ?? 'scenario_assumption',
        evidenceGrade: feature.evidenceGrade ?? null,
      })),
    title: mapTitle,
    note: mapNote,
    areas,
    routes: buildRoutes(world.areas),
    landmarks: buildLandmarks(world.areas, mapMarkers),
    friendlyUnits,
    reportedEnemySignals,
    disclosure: {
      side,
      rawEnemyUnitsIncluded: false,
      enemySignalsSource: 'belief.sightings',
      combatTruthIncluded: false,
    },
  };
}
