import { buildCommanderSessionSnapshot } from './commanderSession.js';
import { appendBattleEvent } from './world.js';
import { advanceBattle } from './clock.js';
import { cancelOrder, issueOrder } from './orders.js';
import { dispatchReconnaissance } from './reconnaissance.js';
import { issueDeception } from './deception.js';
import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';
import { buildCommandDeliveryPlan, commanderFor, playerCommanderId, resolveCommandRecipient } from './commandChain.js';
import { interpretCommanderInstruction } from './instructionInterpreter.js';
import { buildCommanderRouteOptions } from './routePlanner.js';

export const COMMANDER_GATEWAY_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.commanderGateway;

function ownsUnit(world, side, unitId) {
  return world.units[unitId]?.side === side;
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').BattleCommand} command
 * @param {{ side?: string, unitId?: string, fallbackDelaySeconds?: number }} [options]
 */
function commandDelivery(world, command, {
  side,
  unitId,
  fallbackDelaySeconds,
} = {}) {
  const issuerCommanderId = typeof command.issuerCommanderId === 'string' ? command.issuerCommanderId : playerCommanderId(world, side);
  const recipientCommanderId = resolveCommandRecipient(world, {
    side,
    unitId,
    recipientCommanderId: typeof command.recipientCommanderId === 'string' ? command.recipientCommanderId : undefined,
  });
  const plan = buildCommandDeliveryPlan(world, {
    side,
    issuerCommanderId,
    recipientCommanderId,
    unitId,
    fallbackDelaySeconds,
  });
  if (plan.error) return plan;
  return {
    ...plan,
    context: plan.context ? { ...plan.context, delaySeconds: plan.delaySeconds, commandUnitId: unitId ?? null } : null,
  };
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
  if (command.type === 'plan_routes') {
    if (!ownsUnit(world, side, command.unitId)) return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.UNIT_NOT_OWNED, '只能为本方部队规划路线。', { unitId: command.unitId, side }) };
    const options = buildCommanderRouteOptions(world, { side, unitId: command.unitId, targetAreaId: command.targetAreaId });
    if (options.length === 0) return { world, accepted: false, ...battleError(BATTLE_ERROR_CODES.ROUTE_UNREACHABLE, '当前没有可用的认知路线。', { unitId: command.unitId, targetAreaId: command.targetAreaId }) };
    return { world, accepted: true, result: { unitId: command.unitId, targetAreaId: command.targetAreaId, options }, error: null };
  }
  if (command.type === 'free_order' || command.type === 'instruction') {
    const commandText = typeof command.text === 'string' ? command.text : typeof command.rawText === 'string' ? command.rawText : '';
    const interpreted = interpretCommanderInstruction(world, {
      side,
      text: commandText,
      defaultUnitId: typeof command.unitId === 'string' ? command.unitId : null,
      defaultRecipientCommanderId: typeof command.recipientCommanderId === 'string' ? command.recipientCommanderId : null,
    });
    if (interpreted.error) return { world, accepted: false, result: null, interpretation: interpreted.interpretation ?? null, ...interpreted };
    const nested = applyCommanderCommand(world, interpreted.command, {
      side,
      commandDelaySeconds,
      scout,
      maxAdvanceSeconds,
    });
    appendBattleEvent(nested.world, {
      type: 'command_interpreted',
      side,
      rawText: commandText,
      interpretation: interpreted.interpretation,
      accepted: nested.accepted,
      errorCode: nested.errorCode ?? null,
    });
    return { ...nested, interpretation: interpreted.interpretation };
  }
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
    const delivery = commandDelivery(world, command, {
      side,
      unitId: command.unitId,
      fallbackDelaySeconds: commandDelaySeconds,
    });
    if (delivery.error) return { world, accepted: false, ...delivery };
    const result = issueOrder(world, {
      type: command.type,
      unitId: command.unitId,
      targetAreaId: command.targetAreaId,
      priority: command.priority,
      constraints: command.constraints,
      rawText: command.rawText,
    }, { delaySeconds: delivery.delaySeconds, commandContext: delivery.context });
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
    const scoutCommandUnitId = command.commandUnitId ?? scout.commandUnitId ?? commanderFor(world, command.recipientCommanderId ?? scout.recipientCommanderId)?.attachedUnitId;
    const delivery = commandDelivery(world, { ...command, recipientCommanderId: command.recipientCommanderId ?? scout.recipientCommanderId }, {
      side,
      unitId: scoutCommandUnitId,
      fallbackDelaySeconds: commandDelaySeconds,
    });
    if (delivery.error) return { world, accepted: false, ...delivery };
    const result = dispatchReconnaissance(world, {
      ...scout,
      observerSide: side,
      commandContext: delivery.context,
      // actualAreaId stays in the engine-side scenario configuration and is
      // never copied into the commander response.
    });
    return {
      world: result.world,
      accepted: result.error === null,
      result: result.action ? {
        id: result.action.id,
        status: result.action.status,
        readyAt: result.action.readyAt,
        observationId: result.action.observationId ?? null,
        arrivesAt: result.observation?.arrivesAt ?? null,
        communicationMode: result.action.communicationMode ?? delivery.mode,
        recipientCommanderId: result.action.recipientCommanderId ?? null,
      } : null,
      error: result.error,
      errorCode: result.errorCode ?? null,
      errorDetails: result.errorDetails ?? {},
    };
  }
  if (command.type === 'deception') {
    const action = world.deception?.actions?.[command.actionId];
    const targetUnitId = typeof command.targetUnitId === 'string'
      ? command.targetUnitId
      : typeof action?.targetUnitId === 'string'
        ? action.targetUnitId
        : undefined;
    const delivery = commandDelivery(world, {
      ...command,
      recipientCommanderId: command.recipientCommanderId ?? action?.recipientCommanderId,
    }, {
      side,
      unitId: targetUnitId,
      fallbackDelaySeconds: commandDelaySeconds,
    });
    if (delivery.error) return { world, accepted: false, ...delivery };
    const result = issueDeception(world, { ...command, side, commandContext: delivery.context });
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
