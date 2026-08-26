import { buildCommanderSessionSnapshot } from './commanderSession.js';
import { advanceBattle } from './clock.js';
import { cancelOrder, issueOrder } from './orders.js';
import { queueObservation } from './perception.js';
import { issueDeception } from './deception.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';

export const COMMANDER_GATEWAY_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.commanderGateway;

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

/**
 * Apply one commander command without exposing the authoritative enemy state.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').BattleCommand} command
 * @param {import('./contracts').CommanderGatewayOptions} [options]
 */
export function applyCommanderCommand(world, command, {
  side = 'player',
  commandDelaySeconds = 0,
  scout = null,
  maxAdvanceSeconds = BATTLEFIELD_CONFIG.defaults.maxAdvanceSeconds,
} = {}) {
  if (!command || typeof command !== 'object') return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.COMMAND_REQUIRED, '命令必须是对象。') };
  if (world.status === 'ended' && command.type !== 'snapshot') return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.WORLD_ENDED, '战役已经结束，不能继续下达命令。') };

  if (command.type === 'snapshot') return { world, accepted: true, result: null, error: null };
  if (command.type === 'advance') {
    const seconds = Math.max(0, Math.floor(command.seconds ?? 1));
    return { world: advanceBattle(world, seconds, { maxSeconds: maxAdvanceSeconds }), accepted: true, result: { seconds }, error: null };
  }
  if (command.type === 'cancel_order') {
    const result = cancelOrder(world, command.orderId, 'commander_cancelled');
    return {
      world: result.world,
      accepted: result.error === null,
      result: result.error ? null : { orderId: command.orderId },
      error: result.error,
      errorCode: result.errorCode ?? null,
      errorDetails: result.errorDetails ?? {},
    };
  }
  if (['move', 'hold', 'guard', 'cover', 'blockade', 'decoy', 'interdict_supply', 'retreat'].includes(command.type)) {
    if (!ownsUnit(world, side, command.unitId)) return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.UNIT_NOT_OWNED, '只能指挥本方部队。', { unitId: command.unitId, side }) };
    const result = issueOrder(world, {
      type: command.type,
      unitId: command.unitId,
      targetAreaId: command.targetAreaId,
      priority: command.priority,
      constraints: command.constraints,
      rawText: command.rawText,
    }, { delaySeconds: commandDelaySeconds });
    return {
      world: result.world,
      accepted: result.error === null,
      result: result.order,
      error: result.error,
      errorCode: result.errorCode ?? null,
      errorDetails: result.errorDetails ?? {},
    };
  }
  if (command.type === 'scout') {
    if (!scout) return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.SCOUT_NOT_CONFIGURED, '当前场景没有配置侦查方式。') };
    const result = queueObservation(world, {
      ...scout,
      observerSide: side,
      // actualAreaId stays in the engine-side scenario configuration and is
      // never copied into the commander response.
    });
    return {
      world: result.world,
      accepted: result.error === null,
      result: result.observation ? { id: result.observation.id, arrivesAt: result.observation.arrivesAt } : null,
      error: result.error,
      errorCode: result.errorCode ?? null,
      errorDetails: result.errorDetails ?? {},
    };
  }
  if (command.type === 'deception') {
    const result = issueDeception(world, { ...command, side });
    return {
      world: result.world,
      accepted: result.error === null,
      result: result.deception,
      error: result.error,
      errorCode: result.errorCode ?? null,
      errorDetails: result.errorDetails ?? {},
    };
  }
  return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.UNSUPPORTED_COMMAND, `不支持的命令类型：${command.type}`, { type: command.type }) };
}

/**
 * Handle a transport-shaped request and return the next safe commander view.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {{ command?: import('./contracts').BattleCommand, eventCursor?: number }} request
 * @param {import('./contracts').CommanderGatewayOptions} [options]
 */
export function handleCommanderRequest(world, request, options = {}) {
  const command = request && typeof request === 'object' && 'command' in request
    ? request.command
    : request;
  const result = applyCommanderCommand(world, /** @type {import('./contracts').BattleCommand} */ (command), options);
  const response = responseFor(result.world, {
    side: options.side ?? 'player',
    eventCursor: request?.eventCursor ?? 0,
    sessionOptions: options.sessionOptions ?? {},
  });
  return { ...result, response };
}

export { responseFor as buildCommanderGatewayResponse };
