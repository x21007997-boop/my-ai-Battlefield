import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const BATTLE_RESOLUTION_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.battleResolution;

function positionConditionsMet(world, conditions = []) {
  return conditions.every((condition) => world.units[condition.unitId]?.location === condition.areaId);
}

function beliefConditionsMet(world, conditions = []) {
  return conditions.every((condition) => {
    const sighting = world.beliefs[condition.side]?.sightings?.[condition.targetUnitId];
    const allowedAreas = Array.isArray(condition.areaIds)
      ? condition.areaIds
      : condition.areaId
        ? [condition.areaId]
        : [];
    return sighting?.status === 'active' && allowedAreas.includes(sighting.areaId);
  });
}

const TASK_EFFECT_COLLECTIONS = Object.freeze({
  blockade: 'blockades',
  interdict_supply: 'supplyInterdictions',
});

function taskEffectConditionsMet(world, conditions = []) {
  return conditions.every((condition) => {
    const collectionName = TASK_EFFECT_COLLECTIONS[condition.type];
    if (!collectionName) return false;
    return (world[collectionName] ?? []).some((effect) => (
      effect.status === 'active'
      && (!condition.unitId || effect.unitId === condition.unitId)
      && (!condition.areaId || effect.areaId === condition.areaId)
      && (!condition.side || world.units?.[effect.unitId]?.side === condition.side)
      && !['destroyed', 'routed'].includes(world.units?.[effect.unitId]?.status)
    ));
  });
}

function requiredHoldSeconds(victory = {}) {
  return Math.max(0, Math.floor(Number(victory.requiredHoldSeconds ?? 0) || 0));
}

function ensureResolutionProgress(world, victory) {
  world.resolutionProgress ??= {};
  world.resolutionProgress.victory ??= {
    status: 'not_started',
    startedAt: null,
    elapsedSeconds: 0,
  };
  const progress = world.resolutionProgress.victory;
  progress.requiredSeconds = requiredHoldSeconds(victory);
  return progress;
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
  if (victory) {
    const progress = ensureResolutionProgress(next, victory);
    const structuralConditionsMet = positionConditionsMet(next, victory.requiredUnitPositions)
      && taskEffectConditionsMet(next, victory.requiredTaskEffects);
    const entryConditionsMet = structuralConditionsMet && beliefConditionsMet(next, victory.requiredBeliefs);
    const holdConditionsMet = structuralConditionsMet && beliefConditionsMet(next, victory.requiredHoldBeliefs);
    if (entryConditionsMet || (progress.status === 'holding' && holdConditionsMet)) {
      const holdSeconds = requiredHoldSeconds(victory);
      if (holdSeconds === 0) {
        return endBattle(next, {
          id: victory.id,
          result: victory.result ?? 'victory',
          side: victory.side ?? 'player',
          reason: 'victory_conditions_met',
        });
      }
      if (progress.status !== 'holding') {
        progress.status = 'holding';
        progress.startedAt = next.simTime;
        progress.elapsedSeconds = 0;
        appendBattleEvent(next, {
          type: 'victory_hold_started',
          side: victory.side ?? 'player',
          requiredSeconds: holdSeconds,
        });
      }
      progress.elapsedSeconds = Math.max(0, next.simTime - Number(progress.startedAt ?? next.simTime));
      if (progress.elapsedSeconds >= holdSeconds) {
        return endBattle(next, {
          id: victory.id,
          result: victory.result ?? 'victory',
          side: victory.side ?? 'player',
          reason: 'victory_conditions_held',
        });
      }
    } else if (progress.status === 'holding') {
      progress.status = 'broken';
      progress.startedAt = null;
      progress.elapsedSeconds = 0;
      appendBattleEvent(next, {
        type: 'victory_hold_broken',
        side: victory.side ?? 'player',
        reason: 'victory_conditions_lost',
      });
    }
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

function commanderConditionStatus(world, condition, side) {
  const unit = world.units?.[condition.unitId];
  if (!unit || unit.side !== side) return null;
  return {
    unitId: condition.unitId,
    areaId: condition.areaId,
    status: unit.location === condition.areaId ? 'achieved' : 'pending',
  };
}

/**
 * Return only the resolution state a commander needs to make the next decision.
 * Enemy positions and hidden combat details are deliberately excluded.
 */
export function buildCommanderResolutionSnapshot(world, side = 'player') {
  const resolution = world.resolution ?? {};
  const victory = resolution.victory ?? {};
  const progress = world.resolutionProgress?.victory ?? {};
  const requiredSeconds = requiredHoldSeconds(victory);
  const unitPositions = (victory.requiredUnitPositions ?? [])
    .map((condition) => commanderConditionStatus(world, condition, side))
    .filter(Boolean);
  const taskEffects = (victory.requiredTaskEffects ?? [])
    .filter((condition) => !condition.unitId || world.units?.[condition.unitId]?.side === side)
    .map((condition) => ({
      type: condition.type,
      unitId: condition.unitId ?? null,
      areaId: condition.areaId ?? null,
      status: taskEffectConditionsMet(world, [condition]) ? 'achieved' : 'pending',
    }));
  return {
    timeLimitSeconds: Number(resolution.timeLimitSeconds ?? 0),
    victory: {
      id: victory.id ?? null,
      requiredHoldSeconds: requiredSeconds,
      holdElapsedSeconds: Math.min(requiredSeconds, Math.max(0, Number(progress.elapsedSeconds ?? 0))),
      holdStatus: progress.status ?? 'not_started',
      requiredUnitPositions: unitPositions,
      requiredTaskEffects: taskEffects,
    },
  };
}
