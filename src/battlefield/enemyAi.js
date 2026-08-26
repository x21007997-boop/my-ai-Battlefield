import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { issueOrder } from './orders.js';
import { viewBelief } from './perception.js';

export const DEFAULT_AI_INTERVAL_SECONDS = 15;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function chooseReportedTarget(belief) {
  return Object.values(belief.sightings ?? {})
    .filter((sighting) => sighting.status !== 'expired' && sighting.areaId)
    .sort((left, right) => {
      const confidenceDelta = (CONFIDENCE_RANK[right.confidence] ?? 0) - (CONFIDENCE_RANK[left.confidence] ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return (right.receivedAt ?? 0) - (left.receivedAt ?? 0);
    })[0] ?? null;
}

export function runEnemyDecision(world, { side = 'enemy', intervalSeconds } = {}) {
  let next = cloneBattleWorld(world);
  const cadence = intervalSeconds ?? next.ai?.intervalSeconds ?? DEFAULT_AI_INTERVAL_SECONDS;
  next.ai ??= { intervalSeconds: cadence, lastDecisionAt: 0, sides: {} };
  next.ai.sides ??= {};
  next.ai.sides[side] ??= { enabled: true, commandDelaySeconds: 3 };
  next.ai.intervalSeconds = cadence;

  const sideConfig = next.ai.sides[side];
  if (!sideConfig.enabled || next.simTime <= 0 || next.simTime - next.ai.lastDecisionAt < cadence) return next;
  next.ai.lastDecisionAt = next.simTime;

  const belief = viewBelief(next, side);
  const reportedTarget = chooseReportedTarget(belief);
  if (!reportedTarget) return next;

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
      appendBattleEvent(next, {
        type: 'ai_decision',
        side,
        unitId: unit.id,
        targetAreaId: reportedTarget.areaId,
        sourceReportId: reportedTarget.id,
        reason: 'reported_contact',
      });
    });
  return next;
}
