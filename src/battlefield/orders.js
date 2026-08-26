import { appendBattleEvent, cloneBattleWorld } from './world.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const BATTLE_ORDER_TYPES = Object.freeze({
  MOVE: 'move',
  HOLD: 'hold',
  GUARD: 'guard',
  COVER: 'cover',
  BLOCKADE: 'blockade',
  DECOY: 'decoy',
  INTERDICT_SUPPLY: 'interdict_supply',
  RETREAT: 'retreat',
});

export const BATTLE_TASK_ORDER_TYPES = Object.freeze([
  BATTLE_ORDER_TYPES.GUARD,
  BATTLE_ORDER_TYPES.COVER,
  BATTLE_ORDER_TYPES.BLOCKADE,
  BATTLE_ORDER_TYPES.DECOY,
  BATTLE_ORDER_TYPES.INTERDICT_SUPPLY,
  BATTLE_ORDER_TYPES.RETREAT,
]);

function isTaskOrderType(type) {
  return BATTLE_TASK_ORDER_TYPES.includes(type);
}

function nextId(world) {
  return `order-${String(world.orders.length + 1).padStart(4, '0')}`;
}

function neighborsOf(area) {
  return area?.neighbors ?? [];
}

function transitionSchedule(segments = []) {
  let elapsed = 0;
  const schedule = [];
  segments.forEach((segment, segmentIndex) => {
    const travelSeconds = Math.max(0, segment.travelSeconds ?? 0);
    (segment.terrainTransitions ?? []).forEach((transition) => {
      const startProgress = Math.min(1, Math.max(0, transition.startProgress ?? transition.progress ?? 0));
      const endProgress = Math.min(1, Math.max(startProgress, transition.endProgress ?? startProgress));
      schedule.push({
        ...transition,
        segmentIndex,
        terrainType: transition.terrainType ?? transition.type ?? 'terrain',
        startProgress,
        endProgress,
        startTravelSeconds: elapsed + travelSeconds * startProgress,
        endTravelSeconds: elapsed + travelSeconds * endProgress,
        status: 'upcoming',
      });
    });
    elapsed += travelSeconds;
  });
  return schedule.sort((left, right) => left.startTravelSeconds - right.startTravelSeconds);
}

/**
 * Find the shortest playable route using the scenario's area graph.
 *
 * @param {Record<string, import('./contracts').BattleArea>} areas
 * @param {string} fromAreaId
 * @param {string} toAreaId
 * @returns {{ areaIds: string[], travelSeconds: number, segments?: Array<Record<string, unknown>> } | null}
 */
export function findRoute(areas, fromAreaId, toAreaId) {
  if (!areas[fromAreaId] || !areas[toAreaId]) return null;
  if (fromAreaId === toAreaId) return { areaIds: [fromAreaId], travelSeconds: 0, segments: [] };

  const queue = [{ areaId: fromAreaId, areaIds: [fromAreaId], travelSeconds: 0, segments: [] }];
  const visited = new Set([fromAreaId]);
  while (queue.length) {
    const current = queue.shift();
    for (const edge of neighborsOf(areas[current.areaId])) {
      if (visited.has(edge.id) || !areas[edge.id]) continue;
      const next = {
        areaId: edge.id,
        areaIds: [...current.areaIds, edge.id],
        travelSeconds: current.travelSeconds + (edge.travelSeconds ?? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds),
        segments: [...current.segments, {
          fromAreaId: current.areaId,
          toAreaId: edge.id,
          routeId: edge.routeId ?? null,
          travelSeconds: edge.travelSeconds ?? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds,
          terrainTransitions: edge.terrainTransitions ?? [],
        }],
      };
      if (edge.id === toAreaId) return next;
      visited.add(edge.id);
      queue.push(next);
    }
  }
  return null;
}

function validateDraft(world, draft) {
  if (!draft?.unitId || !world.units[draft.unitId]) return battleError(BATTLE_ERROR_CODES.UNIT_NOT_FOUND, '命令引用了不存在的部队。', { unitId: draft?.unitId ?? null });
  if (!Object.values(BATTLE_ORDER_TYPES).includes(draft.type)) return battleError(BATTLE_ERROR_CODES.ORDER_TYPE_UNSUPPORTED, '当前只支持机动、坚守和六类任务命令。', { type: draft?.type ?? null });
  if (draft.type === BATTLE_ORDER_TYPES.MOVE && !draft.targetAreaId) return battleError(BATTLE_ERROR_CODES.ORDER_TARGET_REQUIRED, '移动命令必须指定目标区域。');
  if (isTaskOrderType(draft.type) && draft.type !== BATTLE_ORDER_TYPES.GUARD && !draft.targetAreaId) {
    return battleError(BATTLE_ERROR_CODES.ORDER_TARGET_REQUIRED, `${BATTLEFIELD_CONFIG.taskLabels[draft.type]}命令必须指定目标区域。`, { type: draft.type });
  }
  if (draft.type === BATTLE_ORDER_TYPES.MOVE || isTaskOrderType(draft.type)) {
    const unit = world.units[draft.unitId];
    const targetAreaId = draft.targetAreaId ?? unit.location;
    if (!world.areas[targetAreaId]) {
      const label = draft.type === BATTLE_ORDER_TYPES.MOVE ? '移动' : (BATTLEFIELD_CONFIG.taskLabels[draft.type] ?? '任务');
      return battleError(BATTLE_ERROR_CODES.AREA_NOT_FOUND, `${label}命令引用了不存在的区域。`, { areaId: targetAreaId });
    }
    if (!findRoute(world.areas, unit.location, targetAreaId)) return battleError(BATTLE_ERROR_CODES.ROUTE_UNREACHABLE, '目标区域当前不可达。', { fromAreaId: unit.location, toAreaId: targetAreaId });
  }
  return null;
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {{ type: string, unitId: string, targetAreaId?: string, priority?: string, constraints?: string[], rawText?: string }} draft
 * @param {{ delaySeconds?: number, commandContext?: Record<string, unknown> | null }} [options]
 * @returns {import('./contracts').BattleResult<import('./contracts').BattleOrder>}
 */
export function issueOrder(world, draft, { delaySeconds = 0, commandContext = null } = {}) {
  const next = cloneBattleWorld(world);
  const error = validateDraft(next, draft);
  if (error) return { world: next, order: null, ...error };

  const chainContext = /** @type {Record<string, any> | null} */ (commandContext);
  const commandPath = Array.isArray(chainContext?.commandPath) ? chainContext.commandPath.filter(Boolean).map(String) : [];

  const unit = next.units[draft.unitId];
  const routeTargetAreaId = draft.targetAreaId ?? unit.location;
  const route = draft.type === BATTLE_ORDER_TYPES.MOVE || isTaskOrderType(draft.type)
    ? findRoute(next.areas, unit.location, routeTargetAreaId)
    : { areaIds: [unit.location], travelSeconds: 0, segments: [] };
  const order = {
    id: nextId(next),
    type: draft.type,
    unitId: draft.unitId,
    targetAreaId: routeTargetAreaId,
    taskType: isTaskOrderType(draft.type) ? draft.type : null,
    taskLabel: BATTLEFIELD_CONFIG.taskLabels[draft.type] ?? null,
    priority: draft.priority ?? 'normal',
    constraints: [...(draft.constraints ?? [])],
    originAreaId: unit.location,
    issuedAt: next.simTime,
    deliverAt: next.simTime + Math.max(0, delaySeconds),
    issuedByCommanderId: typeof chainContext?.issuerCommanderId === 'string' ? chainContext.issuerCommanderId : null,
    recipientCommanderId: typeof chainContext?.recipientCommanderId === 'string' ? chainContext.recipientCommanderId : null,
    communicationMode: typeof chainContext?.communicationMode === 'string' ? chainContext.communicationMode : 'legacy',
    commandPath,
    messenger: chainContext?.messenger ? clone(chainContext.messenger) : null,
    status: 'transmitting',
    route: route.areaIds,
    routeSegments: route.segments ?? [],
    terrainTransitions: transitionSchedule(route.segments ?? []),
    movementProgress: 0,
    currentTerrain: null,
    lastTerrainTransition: null,
    totalTravelSeconds: route.travelSeconds,
    remainingTravelSeconds: route.travelSeconds,
    rawText: draft.rawText ?? '',
  };
  next.orders.push(order);
  appendBattleEvent(next, {
    type: 'order_issued',
    orderId: order.id,
    unitId: order.unitId,
    side: unit.side,
    targetAreaId: order.targetAreaId,
    originAreaId: order.originAreaId,
    route: order.route,
    taskType: order.taskType,
    taskLabel: order.taskLabel,
    routeSegments: order.routeSegments,
    terrainTransitions: order.terrainTransitions,
    totalTravelSeconds: order.totalTravelSeconds,
    remainingTravelSeconds: order.remainingTravelSeconds,
    issuedByCommanderId: order.issuedByCommanderId,
    recipientCommanderId: order.recipientCommanderId,
    communicationMode: order.communicationMode,
    commandPath: order.commandPath,
    messenger: order.messenger,
  });
  return { world: next, order, error: null, errorCode: null, errorDetails: {} };
}

export function cancelOrder(world, orderId, reason = 'player_cancelled') {
  const next = cloneBattleWorld(world);
  const order = next.orders.find((item) => item.id === orderId);
  if (!order || ['completed', 'cancelled'].includes(order.status)) return {
    world: next,
    ...battleError(BATTLE_ERROR_CODES.ORDER_NOT_FOUND, '命令不存在或已经结束。', { orderId }),
  };
  order.status = 'cancelled';
  order.cancelledAt = next.simTime;
  order.cancelReason = reason;
  if (next.units[order.unitId]?.currentOrderId === order.id) next.units[order.unitId].currentOrderId = null;
  appendBattleEvent(next, { type: 'order_cancelled', orderId, unitId: order.unitId, side: next.units[order.unitId]?.side, reason });
  return { world: next, error: null, errorCode: null, errorDetails: {} };
}

export function validateOrderDraft(world, draft) {
  return validateDraft(world, draft)?.error ?? null;
}
