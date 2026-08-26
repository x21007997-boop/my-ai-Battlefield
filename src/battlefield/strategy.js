import { BATTLEFIELD_CONFIG } from './config.js';

export const STRATEGY_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.strategy;

export function createStrategyState(sideIds = []) {
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    actions: [],
    lastIssuedAtByKey: {},
    reliabilityBySide: Object.fromEntries(sideIds.map((side) => [side, 1])),
  };
}

export function ensureStrategyState(world) {
  world.strategy ??= createStrategyState(Object.keys(world.sides ?? {}));
  world.strategy.schemaVersion ??= STRATEGY_SCHEMA_VERSION;
  world.strategy.actions ??= [];
  world.strategy.lastIssuedAtByKey ??= {};
  world.strategy.reliabilityBySide ??= {};
  Object.keys(world.sides ?? {}).forEach((side) => {
    world.strategy.reliabilityBySide[side] ??= 1;
  });
  return world.strategy;
}

export function nextStrategyActionId(world) {
  return `strategy-${String((world.strategy?.actions ?? []).length + 1).padStart(4, '0')}`;
}

export function normalizeProbability(value, fallback = 0) {
  const probability = Number(value);
  return Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : fallback;
}

export function strategyCooldownRemaining(world, side, key, cooldownSeconds = 0) {
  const lastIssuedAt = world.strategy?.lastIssuedAtByKey?.[`${side}:${key}`];
  if (lastIssuedAt == null) return 0;
  return Math.max(0, Math.floor(cooldownSeconds) - (world.simTime - lastIssuedAt));
}

export function registerStrategyIssue(world, side, key, simTime = world.simTime) {
  ensureStrategyState(world).lastIssuedAtByKey[`${side}:${key}`] = simTime;
  return world;
}

export function strategyReliabilityMultiplier(world, side) {
  return Math.min(1, Math.max(0, Number(world.strategy?.reliabilityBySide?.[side] ?? 1)));
}

export function recordStrategyReliabilityLoss(world, side, penalty) {
  const strategy = ensureStrategyState(world);
  const previous = strategyReliabilityMultiplier(world, side);
  const current = Math.max(0, previous - Math.max(0, Number(penalty) || 0));
  strategy.reliabilityBySide[side] = current;
  return { previous, current };
}

export function exposureTriggered(world, action, phase = 'dispatch') {
  const probability = normalizeProbability(action.exposureProbability, 0);
  if (probability <= 0) return false;
  let hash = 2166136261;
  const value = `${world.seed}:${action.id}:${action.kind}:${phase}:${action.readyAt ?? action.issuedAt}`;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296 < probability;
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {{ side?: string, sourceId?: string | null, sourceReliability?: string | null }} [options]
 */
export function sourceReliabilityScore(world, {
  side,
  sourceId = null,
  sourceReliability = 'unknown',
} = {}) {
  const source = sourceId ? world.intelligenceSources?.[sourceId] : null;
  const reliabilityKey = String(source?.reliability ?? sourceReliability ?? 'unknown');
  const base = Number(source?.reliabilityScore
    ?? BATTLEFIELD_CONFIG.sourceReliabilityScores[reliabilityKey]
    ?? BATTLEFIELD_CONFIG.sourceReliabilityScores.unknown);
  return Math.max(0, Math.min(1, base * strategyReliabilityMultiplier(world, side)));
}
