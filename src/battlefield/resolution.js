import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const BATTLE_RESOLUTION_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.battleResolution;

function positionConditionsMet(world, conditions = []) {
  return conditions.every((condition) => world.units[condition.unitId]?.location === condition.areaId);
}

function beliefConditionsMet(world, conditions = []) {
  return conditions.every((condition) => {
    const sighting = world.beliefs[condition.side]?.sightings?.[condition.targetUnitId];
    return sighting?.status === 'active' && sighting.areaId === condition.areaId;
  });
}

function endBattle(world, { id, result, side, reason }) {
  world.status = 'ended';
  const ending = (world.endings ?? []).find((candidate) => candidate.id === id);
  world.outcome = {
    id,
    result,
    side: side ?? null,
    reason,
    title: ending?.title ?? id,
    endingStatus: ending?.status ?? null,
    simTime: world.simTime,
  };
  appendBattleEvent(world, {
    type: 'battle_ended',
    outcomeId: id,
    result,
    side: side ?? null,
    reason,
    title: ending?.title ?? id,
  });
  return world;
}

export function evaluateBattleOutcome(world, resolution = world.resolution) {
  const next = cloneBattleWorld(world);
  if (next.status === 'ended' || next.outcome || !resolution) return next;

  const victory = resolution.victory;
  if (victory
    && positionConditionsMet(next, victory.requiredUnitPositions)
    && beliefConditionsMet(next, victory.requiredBeliefs)) {
    return endBattle(next, {
      id: victory.id,
      result: victory.result ?? 'victory',
      side: victory.side ?? 'player',
      reason: 'victory_conditions_met',
    });
  }

  if (resolution.timeLimitSeconds && next.simTime >= resolution.timeLimitSeconds) {
    const timeout = resolution.timeout ?? {};
    return endBattle(next, {
      id: timeout.id ?? 'time-limit',
      result: timeout.result ?? 'strategic-stalemate',
      side: timeout.side ?? null,
      reason: 'time_limit_reached',
    });
  }
  return next;
}
