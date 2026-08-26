import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { cancelOrder } from './orders.js';
import { queueObservation } from './perception.js';
import { BATTLEFIELD_CONFIG } from './config.js';

const COUNTER_SCOUT_SOURCE_ID = 'ai-counter-scout';
const COUNTER_SCOUT_SOURCE_TYPE = 'counter-scout';

function ensureCounterIntelligence(belief) {
  belief.counterIntelligence ??= { reviews: {}, history: [] };
  belief.counterIntelligence.reviews ??= {};
  belief.counterIntelligence.history ??= [];
  return belief.counterIntelligence;
}

function sourceGroup(report) {
  return report.sourceIndependenceGroup ?? report.sourceId ?? report.sourceType ?? 'unknown';
}

function activeReportsForTarget(belief, targetUnitId) {
  return (belief.reports ?? []).filter((report) => (
    report.status === 'active'
    && report.targetUnitId === targetUnitId
    && report.sourceType !== COUNTER_SCOUT_SOURCE_TYPE
  ));
}

/**
 * Assess whether a belief report has independent corroboration or conflicts.
 * This intentionally reads only the observer's belief reports, never the
 * authoritative location of the observed unit.
 *
 * @param {{ reports?: Array<Record<string, unknown>> }} belief
 * @param {Record<string, unknown>} report
 * @param {number} [weakReliabilityThreshold]
 * @returns {{ reportId: string, corroboratingReportIds: string[], conflictingReportIds: string[], independentSourceCount: number, status: string, suspicion: string }}
 */
export function assessReport(
  belief,
  report,
  weakReliabilityThreshold = BATTLEFIELD_CONFIG.defaults.aiWeakReliabilityThreshold,
) {
  const relatedReports = activeReportsForTarget(belief, report.targetUnitId);
  const relatedSourceGroups = new Set(relatedReports.map(sourceGroup));
  const corroboratingReportIds = relatedReports
    .filter((candidate) => candidate.id !== report.id
      && candidate.areaId === report.areaId
      && sourceGroup(candidate) !== sourceGroup(report))
    .map((candidate) => candidate.id);
  const conflictingReportIds = relatedReports
    .filter((candidate) => candidate.id !== report.id
      && candidate.areaId !== report.areaId
      && sourceGroup(candidate) !== sourceGroup(report))
    .map((candidate) => candidate.id);
  const reliabilityScore = typeof report.reliabilityScore === 'number' ? report.reliabilityScore : 0;
  const hasConflict = conflictingReportIds.length > 0;
  const hasWeakSource = reliabilityScore < weakReliabilityThreshold;
  return {
    reportId: String(report.id),
    corroboratingReportIds,
    conflictingReportIds,
    independentSourceCount: relatedSourceGroups.size,
    status: hasConflict ? 'conflicted' : corroboratingReportIds.length > 0 ? 'corroborated' : 'unverified',
    suspicion: hasConflict ? 'high' : hasWeakSource ? 'medium' : 'low',
  };
}

/**
 * Ask an AI side to verify a report through an independent counter-scout.
 * The verification is an internal engine observation and is never projected
 * to the opposing commander.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {{ side?: string, report?: Record<string, unknown>, delaySeconds?: number, reason?: string }} [options]
 * @returns {import('./contracts').BattleWorld}
 */
export function queueReportVerification(world, {
  side,
  report,
  delaySeconds = BATTLEFIELD_CONFIG.defaults.aiVerificationDelaySeconds,
  reason = 'weak_source',
} = {}) {
  let next = cloneBattleWorld(world);
  const observedSide = String(side ?? '');
  const reportId = String(report?.id ?? '');
  const targetUnitId = String(report?.targetUnitId ?? '');
  const belief = next.beliefs?.[observedSide];
  const target = next.units?.[targetUnitId];
  if (!belief || !target || reportId === '') return next;

  const counterIntelligence = ensureCounterIntelligence(belief);
  const existing = counterIntelligence.reviews[reportId];
  if (existing?.status === 'verification_pending') return next;
  if (existing?.status === 'confirmed' || existing?.status === 'discredited') return next;

  const result = queueObservation(next, {
    observerSide: observedSide,
    targetUnitId: target.id,
    reportedAreaId: target.location,
    actualAreaId: target.location,
    delaySeconds: Math.max(0, Math.floor(delaySeconds)),
    confidence: 'high',
    sourceId: COUNTER_SCOUT_SOURCE_ID,
    sourceReliability: 'high',
    sourceIndependenceGroup: COUNTER_SCOUT_SOURCE_ID,
    freshnessSeconds: BATTLEFIELD_CONFIG.defaults.enemyActionReportFreshnessSeconds,
    sourceType: COUNTER_SCOUT_SOURCE_TYPE,
    observation: '内部核验：派出独立斥候复核可疑来报。',
  });
  if (result.error || !result.observation) return result.world;

  next = result.world;
  ensureCounterIntelligence(next.beliefs[observedSide]).reviews[reportId] = {
    reportId,
    targetUnitId,
    requestedAt: next.simTime,
    observationId: result.observation.id,
    status: 'verification_pending',
    reason,
  };
  appendBattleEvent(next, {
    type: 'ai_verification_requested',
    side: observedSide,
    reportId,
    observationId: result.observation.id,
    targetUnitId,
    reason,
    independentSourceCount: assessReport(next.beliefs[observedSide], report).independentSourceCount,
  });
  return next;
}

/**
 * Resolve completed counter-scouts and correct AI belief state. A mismatch
 * lowers the original report reliability and cancels orders issued from it.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {string} side
 * @param {{ reliabilityPenalty?: number }} [options]
 * @returns {import('./contracts').BattleWorld}
 */
export function resolveReportVerifications(world, side, {
  reliabilityPenalty = BATTLEFIELD_CONFIG.defaults.aiReliabilityPenalty,
} = {}) {
  let next = cloneBattleWorld(world);
  const belief = next.beliefs?.[side];
  if (!belief) return next;
  const counterIntelligence = ensureCounterIntelligence(belief);

  Object.values(counterIntelligence.reviews).forEach((review) => {
    if (review.status !== 'verification_pending') return;
    const verification = belief.reports.find((candidate) => candidate.observationId === review.observationId);
    if (!verification) return;
    const original = belief.reports.find((candidate) => candidate.id === review.reportId);
    if (!original) {
      review.status = 'unresolved';
      return;
    }

    const matched = verification.areaId === original.areaId;
    review.status = matched ? 'confirmed' : 'discredited';
    review.resolvedAt = next.simTime;
    review.verificationReportId = verification.id;
    review.verifiedAreaId = verification.areaId;
    const historyEntry = {
      reportId: original.id,
      verificationReportId: verification.id,
      targetUnitId: original.targetUnitId,
      requestedAt: review.requestedAt,
      resolvedAt: next.simTime,
      status: review.status,
      originalAreaId: original.areaId,
      verifiedAreaId: verification.areaId,
    };

    if (matched) {
      original.verificationStatus = 'confirmed';
      appendBattleEvent(next, {
        type: 'report_verified',
        side,
        reportId: original.id,
        verificationReportId: verification.id,
        targetUnitId: original.targetUnitId,
      });
    } else {
      original.status = 'discredited';
      original.verificationStatus = 'discredited';
      original.reliabilityPenalty = reliabilityPenalty;
      original.reliabilityScore = Math.max(0, (original.reliabilityScore ?? 0) - reliabilityPenalty);
      if (next.beliefs[side].sightings[original.targetUnitId]?.id === original.id) {
        next.beliefs[side].sightings[original.targetUnitId] = verification;
      }
      for (const order of next.orders.filter((candidate) => (
        candidate.sourceReportId === original.id
        && ['transmitting', 'executing'].includes(candidate.status)
        && next.units[candidate.unitId]?.side === side
      ))) {
        const cancelled = cancelOrder(next, order.id, 'counter_deception_detected');
        next = cancelled.world;
      }
      appendBattleEvent(next, {
        type: 'report_reliability_reduced',
        side,
        reportId: original.id,
        targetUnitId: original.targetUnitId,
        previousReliabilityScore: (original.reliabilityScore ?? 0) + reliabilityPenalty,
        reliabilityScore: original.reliabilityScore,
        reason: 'independent_verification_conflict',
      });
      appendBattleEvent(next, {
        type: 'deception_detected',
        side,
        reportId: original.id,
        verificationReportId: verification.id,
        targetUnitId: original.targetUnitId,
        reason: 'independent_verification_conflict',
      });
    }
    ensureCounterIntelligence(next.beliefs[side]).history.push(historyEntry);
  });
  return next;
}

export { COUNTER_SCOUT_SOURCE_ID, COUNTER_SCOUT_SOURCE_TYPE };
