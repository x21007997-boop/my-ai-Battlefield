import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { BATTLEFIELD_CONFIG } from './config.js';

export const DEFAULT_SUPPLY_TICK_SECONDS = BATTLEFIELD_CONFIG.defaults.supplyTickSeconds;

function activeSupplyInterdictionsFor(world, unit) {
  return (world.supplyInterdictions ?? []).filter((interdiction) => (
    interdiction.status === 'active'
    && interdiction.areaId === unit.location
    && interdiction.side !== unit.side
    && world.units?.[interdiction.unitId]?.location === interdiction.areaId
    && !['destroyed', 'routed'].includes(world.units?.[interdiction.unitId]?.status)
  ));
}

export function consumeLogistics(world, { intervalSeconds = DEFAULT_SUPPLY_TICK_SECONDS } = {}) {
  const next = cloneBattleWorld(world);
  next.logistics ??= { intervalSeconds, lastSupplyTickAt: 0 };
  next.logistics.intervalSeconds = intervalSeconds;
  if (next.simTime <= 0 || next.simTime - next.logistics.lastSupplyTickAt < intervalSeconds) return next;

  next.logistics.lastSupplyTickAt = next.simTime;
  Object.values(next.units).forEach((unit) => {
    if (['destroyed', 'routed'].includes(unit.status)) return;
    const interdictions = activeSupplyInterdictionsFor(next, unit);
    const before = unit.supplyDays;
    const consumedDays = 1 + (interdictions.length > 0 ? 1 : 0);
    unit.supplyDays = Math.max(0, unit.supplyDays - consumedDays);
    unit.supplyStatus = unit.supplyDays === 0 ? 'depleted' : unit.supplyStatus === 'unknown' ? 'simulation_variable' : unit.supplyStatus;
    unit.fatigue = Math.min(100, unit.fatigue + 1);
    if (interdictions.length > 0) {
      appendBattleEvent(next, {
        type: 'supply_interdicted',
        unitId: unit.id,
        areaId: unit.location,
        interdictionIds: interdictions.map((interdiction) => interdiction.id),
        consumedDays,
      });
    }
    if (unit.supplyDays === 0) {
      unit.morale = Math.max(0, unit.morale - 2);
      unit.readiness = Math.max(0, unit.readiness - 0.04);
      appendBattleEvent(next, { type: 'supply_depleted', unitId: unit.id, before, after: unit.supplyDays });
    } else {
      appendBattleEvent(next, { type: 'supply_consumed', unitId: unit.id, before, after: unit.supplyDays });
    }
  });
  return next;
}
