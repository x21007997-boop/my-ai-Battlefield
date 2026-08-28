import { findRouteCandidates } from './orders.js';
import { movementEnvironment } from './mobility.js';
import { buildArrivalWindow, routeDistanceEstimate, sanitizeRouteSegment } from './commanderEstimate.js';

function riskBand(score) {
  if (score >= 6) return { level: 'high', label: '高' };
  if (score >= 3) return { level: 'medium', label: '中' };
  return { level: 'low', label: '低' };
}

function routeRisk(segments = []) {
  const supplyScore = segments.reduce((score, segment) => score
    + ({ full: 0, limited: 1, none: 3 }[segment.baggageAccess] ?? 1)
    + ({ gentle: 0, rolling: 1, steep: 2 }[segment.grade] ?? 1), 0);
  const exposureScore = segments.reduce((score, segment) => score
    + ({ high: 0, medium: 1, low: 2 }[segment.concealment] ?? 1)
    + ({ detachment: 0, formation: 1, 'army-column': 2 }[segment.capacity] ?? 1), 0);
  return { supply: riskBand(supplyScore), exposure: riskBand(exposureScore) };
}

function evidenceSummary(segments = []) {
  const statuses = [...new Set(segments.flatMap((segment) => [segment.distanceStatus, segment.geometryStatus]).filter(Boolean))];
  const uncertain = segments.reduce((maximum, segment) => Math.max(maximum, Number(segment.distanceUncertainty ?? 0.25)), 0.2);
  return {
    status: statuses.length === 1 ? statuses[0] : 'mixed',
    confidence: uncertain <= 0.2 ? 'high' : uncertain <= 0.4 ? 'medium' : 'low',
    label: uncertain <= 0.2 ? '舆图依据较稳' : uncertain <= 0.4 ? '舆图存在偏差' : '路线仅供推测',
  };
}

/** @param {import('./contracts').BattleWorld} world @param {{ side?: string, unitId?: string, targetAreaId?: string, maxCandidates?: number }} [options] */
export function buildCommanderRouteOptions(world, { side = 'player', unitId, targetAreaId, maxCandidates = 4 } = {}) {
  const unit = world.units?.[unitId];
  if (!unit || unit.side !== side || !world.areas?.[targetAreaId]) return [];
  return findRouteCandidates(world.areas, unit.location, targetAreaId, {
    maxCandidates,
    traveler: unit,
    environment: movementEnvironment(world),
  }).map((route, index) => {
    const uncertainty = Math.max(0.2, ...route.segments.map((segment) => Number(segment.distanceUncertainty ?? 0.25)));
    const risks = routeRisk(route.segments);
    return {
      id: `route-option-${index + 1}`,
      areaIds: [...route.areaIds],
      segments: route.segments.map(sanitizeRouteSegment),
      distanceEstimate: routeDistanceEstimate(route.segments),
      arrivalEstimate: buildArrivalWindow(world.calendar, world.simTime, route.travelSeconds, uncertainty),
      supplyPressure: risks.supply,
      exposureRisk: risks.exposure,
      evidence: evidenceSummary(route.segments),
      recommended: index === 0,
    };
  });
}
