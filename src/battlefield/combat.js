import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { queueObservation } from './perception.js';

export const DEFAULT_COMBAT_INTERVAL_SECONDS = 10;
export const DEFAULT_COMBAT_REPORT_DELAY_SECONDS = 5;

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function activeUnitsInArea(world, areaId) {
  return Object.values(world.units).filter((unit) => unit.location === areaId && unit.strength > 0 && unit.status !== 'destroyed');
}

function groupBySide(units) {
  return Object.values(units.reduce((groups, unit) => {
    (groups[unit.side] ??= []).push(unit);
    return groups;
  }, {}));
}

function combatPower(unit) {
  const moraleFactor = 0.55 + (unit.morale / 200);
  const fatigueFactor = Math.max(0.35, 1 - (unit.fatigue / 200));
  const readinessFactor = Math.max(0.25, unit.readiness ?? 1);
  const supplyFactor = unit.supplyDays > 0 ? 1 : 0.72;
  return unit.strength * moraleFactor * fatigueFactor * readinessFactor * supplyFactor;
}

function chooseTarget(units) {
  return [...units].sort((left, right) => combatPower(right) - combatPower(left))[0];
}

function reportedAreaForCombat(world, actualAreaId, seed) {
  const area = world.areas[actualAreaId];
  const neighbors = (area?.neighbors ?? []).map((neighbor) => neighbor.id).filter((areaId) => world.areas[areaId]);
  const noise = stableHash(`${world.seed}:${seed}:report-noise`);
  if (neighbors.length > 0 && noise < 0.34) return neighbors[Math.floor(noise * neighbors.length / 0.34) % neighbors.length];
  return actualAreaId;
}

function queueCombatReports(world, engagement, exchanges) {
  const reportTargets = new Map();
  exchanges.forEach(({ attacker, defender }) => {
    reportTargets.set(attacker.side, defender.id);
    reportTargets.set(defender.side, attacker.id);
  });

  let next = world;
  reportTargets.forEach((targetUnitId, observerSide) => {
    const target = next.units[targetUnitId];
    if (!target || !next.beliefs[observerSide]) return;
    const reportedAreaId = reportedAreaForCombat(next, engagement.areaId, `${engagement.id}:${next.simTime}:${observerSide}`);
    const areaName = next.areas[reportedAreaId]?.name ?? reportedAreaId;
    const actualAreaName = next.areas[engagement.areaId]?.name ?? engagement.areaId;
    const confidence = reportedAreaId === engagement.areaId ? 'medium' : 'low';
    const result = queueObservation(next, {
      observerSide,
      targetUnitId,
      reportedAreaId,
      actualAreaId: engagement.areaId,
      delaySeconds: DEFAULT_COMBAT_REPORT_DELAY_SECONDS,
      confidence,
      sourceType: 'frontline-report',
      observation: reportedAreaId === engagement.areaId
        ? `前线来报：${areaName}附近疑似发生交战。`
        : `前线来报：${areaName}附近发现敌情，可能与${actualAreaName}方向交战有关。`,
    });
    next = result.world;
  });
  return next;
}

function engagementForArea(world, areaId) {
  return world.engagements.find((engagement) => engagement.areaId === areaId && engagement.status === 'active');
}

function updateEngagements(next) {
  const seenAreas = new Set();
  Object.keys(next.areas).forEach((areaId) => {
    const groups = groupBySide(activeUnitsInArea(next, areaId));
    if (groups.length < 2) return;
    seenAreas.add(areaId);
    let engagement = engagementForArea(next, areaId);
    if (!engagement) {
      engagement = {
        id: `engagement-${String(next.engagements.length + 1).padStart(4, '0')}`,
        areaId,
        startedAt: next.simTime,
        lastResolvedAt: null,
        status: 'active',
        exchangeCount: 0,
      };
      next.engagements.push(engagement);
      appendBattleEvent(next, { type: 'engagement_started', engagementId: engagement.id, areaId });
    }
  });

  next.engagements.filter((engagement) => engagement.status === 'active' && !seenAreas.has(engagement.areaId)).forEach((engagement) => {
    engagement.status = 'ended';
    engagement.endedAt = next.simTime;
    appendBattleEvent(next, { type: 'engagement_ended', engagementId: engagement.id, areaId: engagement.areaId });
  });
}

export function resolveCombat(world, { intervalSeconds = DEFAULT_COMBAT_INTERVAL_SECONDS } = {}) {
  let next = cloneBattleWorld(world);
  next.combat ??= { intervalSeconds, lastResolutionAt: 0 };
  next.engagements ??= [];
  next.combat.intervalSeconds = intervalSeconds;
  updateEngagements(next);
  if (next.simTime <= 0 || next.simTime - next.combat.lastResolutionAt < intervalSeconds) return next;

  next.combat.lastResolutionAt = next.simTime;
  next.engagements.filter((engagement) => engagement.status === 'active').forEach((engagement) => {
    const groups = groupBySide(activeUnitsInArea(next, engagement.areaId));
    if (groups.length < 2) return;
    const orderedGroups = [...groups].sort((left, right) => chooseTarget(right).id.localeCompare(chooseTarget(left).id));
    const exchanges = orderedGroups.map((attackers, index) => {
      const defenders = orderedGroups[(index + 1) % orderedGroups.length];
      const attacker = chooseTarget(attackers);
      const defender = chooseTarget(defenders);
      const roll = 0.82 + stableHash(`${next.seed}:${next.simTime}:${attacker.id}:${defender.id}`) * 0.36;
      const damage = Math.max(1, Math.round(combatPower(attacker) * 0.06 * roll));
      defender.strength = Math.max(0, defender.strength - damage);
      defender.morale = Math.max(0, defender.morale - (damage >= Math.max(1, defender.strength * 0.03) ? 2 : 1));
      defender.fatigue = Math.min(100, defender.fatigue + 2);
      if (defender.strength === 0) {
        defender.status = 'destroyed';
        defender.currentOrderId = null;
      } else if (defender.morale <= 10) {
        defender.status = 'routed';
        defender.currentOrderId = null;
      }
      appendBattleEvent(next, {
        type: 'combat_exchange',
        engagementId: engagement.id,
        areaId: engagement.areaId,
        attackerUnitId: attacker.id,
        defenderUnitId: defender.id,
        damage,
        defenderRemaining: defender.strength,
        defenderStatus: defender.status,
      });
      return { attacker, defender, damage };
    });
    engagement.lastResolvedAt = next.simTime;
    engagement.exchangeCount += exchanges.length;
    next = queueCombatReports(next, engagement, exchanges);
  });
  updateEngagements(next);
  return next;
}
