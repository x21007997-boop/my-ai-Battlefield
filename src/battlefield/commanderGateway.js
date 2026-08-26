import { buildCommanderSessionSnapshot } from './commanderSession.js';
import { advanceBattle } from './clock.js';
import { cancelOrder, issueOrder } from './orders.js';
import { queueObservation } from './perception.js';
import { issueDeception } from './deception.js';

export const COMMANDER_GATEWAY_SCHEMA_VERSION = 1;

function ownsUnit(world, side, unitId) {
  return world.units[unitId]?.side === side;
}

function responseFor(world, {
  side = 'player',
  eventCursor = 0,
  sessionOptions = {},
} = {}) {
  const session = buildCommanderSessionSnapshot(world, { side, ...sessionOptions });
  const cursor = Math.max(0, Math.floor(eventCursor));
  return {
    schemaVersion: COMMANDER_GATEWAY_SCHEMA_VERSION,
    session,
    events: session.eventLog.slice(cursor),
    nextEventCursor: session.eventLog.length,
  };
}

export function applyCommanderCommand(world, command, {
  side = 'player',
  commandDelaySeconds = 0,
  scout = null,
  maxAdvanceSeconds = 3600,
} = {}) {
  if (!command || typeof command !== 'object') return { world, accepted: false, error: '命令必须是对象。' };
  if (world.status === 'ended' && command.type !== 'snapshot') return { world, accepted: false, error: '战役已经结束，不能继续下达命令。' };

  if (command.type === 'snapshot') return { world, accepted: true, result: null, error: null };
  if (command.type === 'advance') {
    const seconds = Math.max(0, Math.floor(command.seconds ?? 1));
    return { world: advanceBattle(world, seconds, { maxSeconds: maxAdvanceSeconds }), accepted: true, result: { seconds }, error: null };
  }
  if (command.type === 'cancel_order') {
    const result = cancelOrder(world, command.orderId, 'commander_cancelled');
    return { world: result.world, accepted: result.error === null, result: result.error ? null : { orderId: command.orderId }, error: result.error };
  }
  if (command.type === 'move' || command.type === 'hold') {
    if (!ownsUnit(world, side, command.unitId)) return { world, accepted: false, error: '只能指挥本方部队。' };
    const result = issueOrder(world, {
      type: command.type,
      unitId: command.unitId,
      targetAreaId: command.targetAreaId,
      priority: command.priority,
      constraints: command.constraints,
      rawText: command.rawText,
    }, { delaySeconds: commandDelaySeconds });
    return { world: result.world, accepted: result.error === null, result: result.order, error: result.error };
  }
  if (command.type === 'scout') {
    if (!scout) return { world, accepted: false, error: '当前场景没有配置侦查方式。' };
    const result = queueObservation(world, {
      ...scout,
      observerSide: side,
      // actualAreaId stays in the engine-side scenario configuration and is
      // never copied into the commander response.
    });
    return { world: result.world, accepted: result.error === null, result: result.observation ? { id: result.observation.id, arrivesAt: result.observation.arrivesAt } : null, error: result.error };
  }
  if (command.type === 'deception') {
    const result = issueDeception(world, { ...command, side });
    return { world: result.world, accepted: result.error === null, result: result.deception, error: result.error };
  }
  return { world, accepted: false, error: `不支持的命令类型：${command.type}` };
}

export function handleCommanderRequest(world, request, options = {}) {
  const result = applyCommanderCommand(world, request?.command ?? request, options);
  const response = responseFor(result.world, {
    side: options.side ?? 'player',
    eventCursor: request?.eventCursor ?? 0,
    sessionOptions: options.sessionOptions ?? {},
  });
  return { ...result, response };
}

export { responseFor as buildCommanderGatewayResponse };
