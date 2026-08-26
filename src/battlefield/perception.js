import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, BattleValidationError, battleError } from './errors.js';

const SOURCE_RELIABILITY_SCORES = BATTLEFIELD_CONFIG.sourceReliabilityScores;

export const REPORT_UNCERTAINTY_PROFILES = BATTLEFIELD_CONFIG.reportUncertaintyProfiles;

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

function resolveSource(next, sourceId, sourceReliability, sourceType, sourceIndependenceGroup) {
  const source = sourceId ? next.intelligenceSources?.[sourceId] : null;
  const reliability = source?.reliability ?? sourceReliability ?? 'unknown';
  return {
    source,
    reliability,
    reliabilityScore: source?.reliabilityScore ?? SOURCE_RELIABILITY_SCORES[reliability] ?? SOURCE_RELIABILITY_SCORES.unknown,
    independenceGroup: sourceIndependenceGroup ?? source?.independenceGroup ?? sourceId ?? sourceType ?? 'unknown',
  };
}

function nextObservationId(world) {
  return `observation-${String(world.observations.length + 1).padStart(4, '0')}`;
}

function nextReportId(belief) {
  return `report-${String(belief.reports.length + 1).padStart(4, '0')}`;
}

/**
 * Queue information for one observer. `actualAreaId` remains engine-only.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').QueueObservationOptions} [options]
 * @returns {import('./contracts').BattleResult<import('./contracts').BattleObservation> & { observation: import('./contracts').BattleObservation | null }}
 */
export function queueObservation(world, {
  observerSide,
  targetUnitId,
  reportedAreaId,
  delaySeconds = BATTLEFIELD_CONFIG.defaults.observationDelaySeconds,
  confidence = 'medium',
  sourceId = null,
  sourceReliability = null,
  sourceIndependenceGroup = null,
  freshnessSeconds = BATTLEFIELD_CONFIG.defaults.reportFreshnessSeconds,
  sourceType = 'scout',
  observedAt = world.simTime,
  actualAreaId,
  observation = '发现目标活动迹象',
} = /** @type {import('./contracts').QueueObservationOptions} */ ({})) {
  const next = cloneBattleWorld(world);
  if (!next.beliefs[observerSide]) return { world: next, observation: null, ...battleError(BATTLE_ERROR_CODES.OBSERVER_SIDE_NOT_FOUND, '观察者阵营不存在。', { observerSide }) };
  if (!next.units[targetUnitId]) return { world: next, observation: null, ...battleError(BATTLE_ERROR_CODES.OBSERVATION_TARGET_NOT_FOUND, '观察目标部队不存在。', { targetUnitId }) };
  if (!next.areas[reportedAreaId]) return { world: next, observation: null, ...battleError(BATTLE_ERROR_CODES.AREA_NOT_FOUND, '报告区域不存在。', { areaId: reportedAreaId }) };

  const target = next.units[targetUnitId];
  const source = resolveSource(next, sourceId, sourceReliability, sourceType, sourceIndependenceGroup);
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
    sourceIndependenceGroup: source.independenceGroup,
    freshnessSeconds: Math.max(BATTLEFIELD_CONFIG.defaults.minimumReportFreshnessSeconds, Math.floor(freshnessSeconds)),
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
  return { world: next, observation: report, error: null, errorCode: null, errorDetails: {} };
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').BattleObservation} observation
 * @returns {import('./contracts').BattleResult<import('./contracts').BeliefReport> & { report?: import('./contracts').BeliefReport }}
 */
export function applyObservation(world, observation) {
  const next = cloneBattleWorld(world);
  const belief = next.beliefs[observation.observerSide];
  if (!belief) return { world: next, ...battleError(BATTLE_ERROR_CODES.BELIEF_NOT_FOUND, '观察者认知状态不存在。', { observerSide: observation.observerSide }) };
  if (observation.status === 'delivered') return { world: next, error: null, errorCode: null, errorDetails: {} };

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
    sourceIndependenceGroup: observation.sourceIndependenceGroup,
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
  return { world: next, report, error: null, errorCode: null, errorDetails: {} };
}

/**
 * Return a deep-cloned commander/AI belief projection, never the mutable world.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {string} side
 */
export function viewBelief(world, side) {
  const belief = world.beliefs[side];
  if (!belief) throw new BattleValidationError(BATTLE_ERROR_CODES.BELIEF_NOT_FOUND, `阵营 ${side} 不存在。`, { side });
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
