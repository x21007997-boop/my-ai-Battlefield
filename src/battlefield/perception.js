import { appendBattleEvent, cloneBattleWorld } from './world.js';

const SOURCE_RELIABILITY_SCORES = {
  high: 0.85,
  medium: 0.65,
  low: 0.4,
  variable: 0.5,
  'to-be-calibrated': 0.5,
  unknown: 0.5,
};

export const REPORT_UNCERTAINTY_PROFILES = Object.freeze({
  high: { radiusNormalized: 0.04, maxCandidateNeighbors: 0, label: '误差较小' },
  medium: { radiusNormalized: 0.09, maxCandidateNeighbors: 1, label: '可能偏离相邻区域' },
  low: { radiusNormalized: 0.16, maxCandidateNeighbors: 2, label: '可能偏离附近区域' },
  unknown: { radiusNormalized: 0.2, maxCandidateNeighbors: 3, label: '仅供参考' },
});

function buildReportUncertainty(world, reportedAreaId, confidence) {
  const profile = REPORT_UNCERTAINTY_PROFILES[confidence] ?? REPORT_UNCERTAINTY_PROFILES.unknown;
  const neighbors = (world.areas[reportedAreaId]?.neighbors ?? [])
    .map((neighbor) => (typeof neighbor === 'string' ? neighbor : neighbor.id))
    .filter((areaId) => areaId && world.areas[areaId])
    .slice(0, profile.maxCandidateNeighbors);
  return {
    level: Object.prototype.hasOwnProperty.call(REPORT_UNCERTAINTY_PROFILES, confidence) ? confidence : 'unknown',
    radiusNormalized: profile.radiusNormalized,
    candidateAreaIds: [reportedAreaId, ...neighbors],
    label: profile.label,
  };
}

function resolveSource(next, sourceId, sourceReliability) {
  const source = sourceId ? next.intelligenceSources?.[sourceId] : null;
  const reliability = source?.reliability ?? sourceReliability ?? 'unknown';
  return {
    source,
    reliability,
    reliabilityScore: source?.reliabilityScore ?? SOURCE_RELIABILITY_SCORES[reliability] ?? SOURCE_RELIABILITY_SCORES.unknown,
  };
}

function nextObservationId(world) {
  return `observation-${String(world.observations.length + 1).padStart(4, '0')}`;
}

function nextReportId(belief) {
  return `report-${String(belief.reports.length + 1).padStart(4, '0')}`;
}

export function queueObservation(world, {
  observerSide,
  targetUnitId,
  reportedAreaId,
  delaySeconds = 0,
  confidence = 'medium',
  sourceId = null,
  sourceReliability = null,
  freshnessSeconds = 30,
  sourceType = 'scout',
  observedAt = world.simTime,
  actualAreaId,
  observation = '发现目标活动迹象',
} = {}) {
  const next = cloneBattleWorld(world);
  if (!next.beliefs[observerSide]) return { world: next, observation: null, error: '观察者阵营不存在。' };
  if (!next.units[targetUnitId]) return { world: next, observation: null, error: '观察目标部队不存在。' };
  if (!next.areas[reportedAreaId]) return { world: next, observation: null, error: '报告区域不存在。' };

  const target = next.units[targetUnitId];
  const source = resolveSource(next, sourceId, sourceReliability);
  const uncertainty = buildReportUncertainty(next, reportedAreaId, confidence);
  const report = {
    id: nextObservationId(next),
    observerSide,
    targetUnitId,
    actualAreaId: actualAreaId ?? target.location,
    reportedAreaId,
    confidence,
    sourceId,
    sourceReliability: source.reliability,
    reliabilityScore: source.reliabilityScore,
    freshnessSeconds: Math.max(1, Math.floor(freshnessSeconds)),
    sourceType,
    observedAt,
    arrivesAt: next.simTime + Math.max(0, delaySeconds),
    status: 'in_transit',
    observation,
    uncertainty,
  };
  next.observations.push(report);
  appendBattleEvent(next, {
    type: 'observation_created',
    observationId: report.id,
    observerSide,
    targetUnitId,
    reportedAreaId,
    confidence: report.confidence,
    sourceId: report.sourceId,
    sourceType: report.sourceType,
    arrivesAt: report.arrivesAt,
    uncertainty: report.uncertainty,
  });
  return { world: next, observation: report, error: null };
}

export function applyObservation(world, observation) {
  const next = cloneBattleWorld(world);
  const belief = next.beliefs[observation.observerSide];
  if (!belief) return { world: next, error: '观察者认知状态不存在。' };
  if (observation.status === 'delivered') return { world: next, error: null };

  const report = {
    id: nextReportId(belief),
    observationId: observation.id,
    targetUnitId: observation.targetUnitId,
    areaId: observation.reportedAreaId,
    confidence: observation.confidence,
    sourceId: observation.sourceId,
    sourceReliability: observation.sourceReliability,
    reliabilityScore: observation.reliabilityScore,
    sourceType: observation.sourceType,
    observedAt: observation.observedAt,
    receivedAt: next.simTime,
    expiresAt: next.simTime + observation.freshnessSeconds,
    freshnessSeconds: observation.freshnessSeconds,
    status: 'active',
    text: observation.observation,
    uncertainty: observation.uncertainty ?? buildReportUncertainty(next, observation.reportedAreaId, observation.confidence),
  };
  belief.sightings[observation.targetUnitId] = report;
  belief.reports.push(report);
  const storedObservation = next.observations.find((item) => item.id === observation.id);
  if (storedObservation) {
    storedObservation.status = 'delivered';
    storedObservation.deliveredAt = next.simTime;
  }
  appendBattleEvent(next, {
    type: 'report_arrived',
    reportId: report.id,
    observerSide: observation.observerSide,
    targetUnitId: observation.targetUnitId,
    areaId: report.areaId,
    reportedAreaId: report.areaId,
    sourceId: report.sourceId,
    sourceType: report.sourceType,
    confidence: report.confidence,
    text: report.text,
    uncertainty: report.uncertainty,
    expiresAt: report.expiresAt,
  });
  return { world: next, report, error: null };
}

export function viewBelief(world, side) {
  const belief = world.beliefs[side];
  if (!belief) throw new Error(`阵营 ${side} 不存在。`);
  const ownUnits = Object.values(world.units)
    .filter((unit) => unit.side === side)
    .map((unit) => ({ ...unit }));
  return {
    schemaVersion: world.schemaVersion,
    simulatorVersion: world.simulatorVersion,
    scenarioId: world.scenarioId,
    simTime: world.simTime,
    side,
    areas: JSON.parse(JSON.stringify(world.areas)),
    ownUnits,
    sightings: JSON.parse(JSON.stringify(belief.sightings)),
    reports: JSON.parse(JSON.stringify(belief.reports)),
  };
}
