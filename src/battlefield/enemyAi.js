import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { issueOrder } from './orders.js';
import { queueObservation, viewBelief } from './perception.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const DEFAULT_AI_INTERVAL_SECONDS = BATTLEFIELD_CONFIG.defaults.aiIntervalSeconds;
export const DEFAULT_ENEMY_ACTION_REPORT_DELAY_SECONDS = BATTLEFIELD_CONFIG.defaults.enemyActionReportDelaySeconds;

const CONFIDENCE_RANK = BATTLEFIELD_CONFIG.confidenceRank;

function chooseReportedTarget(belief) {
  return Object.values(belief.sightings ?? {})
    .filter((sighting) => sighting.status !== 'expired' && sighting.areaId)
    .sort((left, right) => {
      const confidenceDelta = (CONFIDENCE_RANK[right.confidence] ?? 0) - (CONFIDENCE_RANK[left.confidence] ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return (right.receivedAt ?? 0) - (left.receivedAt ?? 0);
    })[0] ?? null;
}

/**
 * Let an AI side act on its own belief projection, never on commander data.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {{ side?: string, intervalSeconds?: number }} [options]
 * @returns {import('./contracts').BattleWorld}
 */
export function runEnemyDecision(world, { side = 'enemy', intervalSeconds } = {}) {
  let next = cloneBattleWorld(world);
  const cadence = intervalSeconds ?? next.ai?.intervalSeconds ?? DEFAULT_AI_INTERVAL_SECONDS;
  next.ai ??= { intervalSeconds: cadence, lastDecisionAt: 0, sides: {} };
  next.ai.sides ??= {};
  next.ai.sides[side] ??= { enabled: true, commandDelaySeconds: BATTLEFIELD_CONFIG.defaults.aiCommandDelaySeconds };
  next.ai.intervalSeconds = cadence;

  const sideConfig = next.ai.sides[side];
  if (!sideConfig.enabled || next.simTime <= 0 || next.simTime - next.ai.lastDecisionAt < cadence) return next;
  next.ai.lastDecisionAt = next.simTime;

  const belief = viewBelief(next, side);
  const reportedTarget = chooseReportedTarget(belief);
  if (!reportedTarget) return next;

  const observerSide = Object.keys(next.sides ?? {})
    .find((candidate) => candidate !== side && next.beliefs?.[candidate]) ?? null;
  let reactedUnitId = null;
  belief.ownUnits
    .filter((unit) => unit.status === 'active' && !unit.currentOrderId && unit.location !== reportedTarget.areaId)
    .forEach((unit) => {
      const result = issueOrder(next, {
        type: 'move',
        unitId: unit.id,
        targetAreaId: reportedTarget.areaId,
        priority: 'normal',
        rawText: `根据${reportedTarget.sourceType ?? '情报'}向${next.areas[reportedTarget.areaId]?.name ?? reportedTarget.areaId}机动`,
      }, { delaySeconds: sideConfig.commandDelaySeconds ?? 3 });
      if (result.error) return;
      next = result.world;
      reactedUnitId ??= unit.id;
      appendBattleEvent(next, {
        type: 'ai_decision',
        side,
        unitId: unit.id,
        targetAreaId: reportedTarget.areaId,
        sourceReportId: reportedTarget.id,
        reason: 'reported_contact',
      });
    });

  // The opposing commander does not see this internal decision. They only
  // receive a delayed, imperfect frontline report that the enemy may be
  // moving toward the area their own belief state selected.
  if (reactedUnitId && observerSide) {
    const reportedAreaName = next.areas[reportedTarget.areaId]?.name ?? reportedTarget.areaId;
    const targetUnit = next.units[reactedUnitId];
    const confidence = reportedTarget.confidence === 'low' ? 'low' : 'medium';
    const report = queueObservation(next, {
      observerSide,
      targetUnitId: reactedUnitId,
      reportedAreaId: reportedTarget.areaId,
      actualAreaId: targetUnit?.location,
      delaySeconds: DEFAULT_ENEMY_ACTION_REPORT_DELAY_SECONDS,
      confidence,
      sourceReliability: 'variable',
      freshnessSeconds: 20,
      sourceType: 'frontline-report',
      observation: `前线来报：${reportedAreaName}方向疑似有敌军调动，可能正向该处机动。`,
    });
    next = report.world;
  }
  return next;
}
