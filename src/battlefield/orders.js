import { appendBattleEvent, cloneBattleWorld } from './world.js';

export const BATTLE_ORDER_TYPES = Object.freeze({
  MOVE: 'move',
  HOLD: 'hold',
});

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

export function findRoute(areas, fromAreaId, toAreaId) {
  if (!areas[fromAreaId] || !areas[toAreaId]) return null;
  if (fromAreaId === toAreaId) return { areaIds: [fromAreaId], travelSeconds: 0 };

  const queue = [{ areaId: fromAreaId, areaIds: [fromAreaId], travelSeconds: 0, segments: [] }];
  const visited = new Set([fromAreaId]);
  while (queue.length) {
    const current = queue.shift();
    for (const edge of neighborsOf(areas[current.areaId])) {
      if (visited.has(edge.id) || !areas[edge.id]) continue;
      const next = {
        areaId: edge.id,
        areaIds: [...current.areaIds, edge.id],
        travelSeconds: current.travelSeconds + (edge.travelSeconds ?? 10),
        segments: [...current.segments, {
          fromAreaId: current.areaId,
          toAreaId: edge.id,
          routeId: edge.routeId ?? null,
          travelSeconds: edge.travelSeconds ?? 10,
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
  if (!draft?.unitId || !world.units[draft.unitId]) return '命令引用了不存在的部队。';
  if (!Object.values(BATTLE_ORDER_TYPES).includes(draft.type)) return '当前只支持移动和坚守命令。';
  if (draft.type === BATTLE_ORDER_TYPES.MOVE && !draft.targetAreaId) return '移动命令必须指定目标区域。';
  if (draft.type === BATTLE_ORDER_TYPES.MOVE) {
    const unit = world.units[draft.unitId];
    if (!world.areas[draft.targetAreaId]) return '移动命令引用了不存在的区域。';
    if (!findRoute(world.areas, unit.location, draft.targetAreaId)) return '目标区域当前不可达。';
  }
  return null;
}

export function issueOrder(world, draft, { delaySeconds = 0 } = {}) {
  const next = cloneBattleWorld(world);
  const error = validateDraft(next, draft);
  if (error) return { world: next, order: null, error };

  const unit = next.units[draft.unitId];
  const route = draft.type === BATTLE_ORDER_TYPES.MOVE
    ? findRoute(next.areas, unit.location, draft.targetAreaId)
    : { areaIds: [unit.location], travelSeconds: 0 };
  const order = {
    id: nextId(next),
    type: draft.type,
    unitId: draft.unitId,
    targetAreaId: draft.targetAreaId ?? unit.location,
    priority: draft.priority ?? 'normal',
    constraints: [...(draft.constraints ?? [])],
    originAreaId: unit.location,
    issuedAt: next.simTime,
    deliverAt: next.simTime + Math.max(0, delaySeconds),
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
    routeSegments: order.routeSegments,
    terrainTransitions: order.terrainTransitions,
    totalTravelSeconds: order.totalTravelSeconds,
    remainingTravelSeconds: order.remainingTravelSeconds,
  });
  return { world: next, order, error: null };
}

export function cancelOrder(world, orderId, reason = 'player_cancelled') {
  const next = cloneBattleWorld(world);
  const order = next.orders.find((item) => item.id === orderId);
  if (!order || ['completed', 'cancelled'].includes(order.status)) return { world: next, error: '命令不存在或已经结束。' };
  order.status = 'cancelled';
  order.cancelledAt = next.simTime;
  order.cancelReason = reason;
  if (next.units[order.unitId]?.currentOrderId === order.id) next.units[order.unitId].currentOrderId = null;
  appendBattleEvent(next, { type: 'order_cancelled', orderId, unitId: order.unitId, side: next.units[order.unitId]?.side, reason });
  return { world: next, error: null };
}

export function validateOrderDraft(world, draft) {
  return validateDraft(world, draft);
}
