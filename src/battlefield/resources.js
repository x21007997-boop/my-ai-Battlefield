import { BATTLE_ERROR_CODES, battleError } from './errors.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const RESOURCE_LABELS = BATTLEFIELD_CONFIG.resourceLabels;

function normalizedCost(cost = {}) {
  const result = {};
  Object.entries(cost ?? {}).forEach(([key, value]) => {
    const amount = Math.max(0, Math.floor(Number(value) || 0));
    if (amount > 0) result[key] = amount;
  });
  return result;
}

/**
 * Keep scenario-defined command resources separate from historical facts.
 * An absent ledger means the scenario has not enabled resource pressure yet.
 */
export function normalizeResourceLedger(resources, sideIds = []) {
  if (!resources || typeof resources !== 'object') return {};
  const allowedSides = new Set(sideIds);
  return Object.fromEntries(Object.entries(resources)
    .filter(([side, ledger]) => allowedSides.size === 0 || allowedSides.has(side))
    .map(([side, ledger]) => [side, Object.fromEntries(
      Object.entries(ledger ?? {})
        .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))]),
    )]));
}

/**
 * Check a cost without mutating the world. Scenarios that do not configure a
 * ledger remain backward-compatible and treat omitted costs as free actions.
 */
export function resourceCostError(world, side, cost = {}) {
  const normalized = normalizedCost(cost);
  const ledger = world.resources?.[side];
  if (!ledger || Object.keys(normalized).length === 0) return null;
  for (const [key, amount] of Object.entries(normalized)) {
    const available = Number(ledger[key] ?? 0);
    if (available < amount) {
      return battleError(
        BATTLE_ERROR_CODES.RESOURCE_INSUFFICIENT,
        `${RESOURCE_LABELS[key] ?? key}不足，无法执行该操作。`,
        { side, resource: key, required: amount, available },
      );
    }
  }
  return null;
}

export function spendResources(world, side, cost = {}) {
  const ledger = world.resources?.[side];
  if (!ledger) return world;
  Object.entries(normalizedCost(cost)).forEach(([key, amount]) => {
    ledger[key] = Math.max(0, Number(ledger[key] ?? 0) - amount);
  });
  return world;
}

export function resourceCostSummary(cost = {}) {
  return Object.entries(normalizedCost(cost))
    .map(([key, amount]) => `${RESOURCE_LABELS[key] ?? key} ${amount}`)
    .join(' · ');
}
