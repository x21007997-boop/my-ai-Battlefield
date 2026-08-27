import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';

export const COMMAND_CHAIN_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.commandChain;

function normalizeSeconds(value, fallback = 0) {
  return Math.max(0, Math.floor(Number(value ?? fallback) || 0));
}

function normalizeCommander(commander = {}) {
  const attachedUnitIds = Array.isArray(commander.attachedUnitIds)
    ? commander.attachedUnitIds.filter(Boolean).map(String)
    : commander.attachedUnitId
      ? [String(commander.attachedUnitId)]
      : [];
  return {
    id: String(commander.id ?? ''),
    side: String(commander.side ?? ''),
    name: String(commander.name ?? commander.id ?? '未命名军官'),
    role: String(commander.role ?? '军官'),
    rank: commander.rank ?? null,
    superiorCommanderId: commander.superiorCommanderId ?? commander.parentCommanderId ?? null,
    attachedUnitId: commander.attachedUnitId ?? attachedUnitIds[0] ?? null,
    attachedUnitIds,
    locationAreaId: commander.locationAreaId ?? commander.commandPostAreaId ?? null,
    locationStatus: commander.locationStatus ?? (attachedUnitIds.length > 0 ? 'with_unit' : 'command_post'),
    isPlayer: commander.isPlayer === true,
    authority: commander.authority ?? 'field',
    historicalStatus: commander.historicalStatus ?? 'scenario_assumption',
    riskProfile: commander.riskProfile ?? null,
    decisionProfile: commander.decisionProfile ? {
      ...commander.decisionProfile,
      terrainFamiliarity: Array.isArray(commander.decisionProfile.terrainFamiliarity)
        ? [...commander.decisionProfile.terrainFamiliarity]
        : [],
    } : null,
    sourceIds: [...(commander.sourceIds ?? [])],
  };
}

/**
 * Build the command-chain state from scenario personnel definitions. Personnel
 * are scenario data; this module only supplies movement and delivery rules.
 *
 * @param {Array<Record<string, unknown>>} commanders
 * @param {Record<string, any>} [options]
 */
export function createCommandChainState(commanders = [], options = {}) {
  const commanderList = Array.isArray(commanders) ? commanders : Object.values(commanders ?? {});
  const normalized = commanderList
    .map(normalizeCommander)
    .filter((commander) => commander.id && commander.side);
  const commanderMap = Object.fromEntries(normalized.map((commander) => [commander.id, commander]));
  const explicitPlayerIds = options.playerCommanderIdsBySide ?? options.playerCommanderIds ?? {};
  const playerCommanderIdsBySide = { ...explicitPlayerIds };
  normalized.filter((commander) => commander.isPlayer).forEach((commander) => {
    playerCommanderIdsBySide[commander.side] ??= commander.id;
  });
  return {
    schemaVersion: COMMAND_CHAIN_SCHEMA_VERSION,
    commanders: commanderMap,
    playerCommanderIdsBySide,
    messengerPolicy: {
      baseDelaySeconds: normalizeSeconds(options.messengerPolicy?.baseDelaySeconds, BATTLEFIELD_CONFIG.defaults.messengerBaseDelaySeconds),
      routeTravelFactor: Math.max(0, Number(options.messengerPolicy?.routeTravelFactor ?? BATTLEFIELD_CONFIG.defaults.messengerRouteTravelFactor)),
      fallbackDelaySeconds: normalizeSeconds(options.messengerPolicy?.fallbackDelaySeconds, BATTLEFIELD_CONFIG.defaults.messengerFallbackDelaySeconds),
      directDelaySeconds: normalizeSeconds(options.messengerPolicy?.directDelaySeconds, BATTLEFIELD_CONFIG.defaults.directCommandDelaySeconds),
    },
  };
}

export function ensureCommandChain(world) {
  world.commandChain ??= createCommandChainState();
  world.commandChain.commanders ??= {};
  world.commandChain.playerCommanderIdsBySide ??= {};
  world.commandChain.messengerPolicy ??= createCommandChainState().messengerPolicy;
  return world.commandChain;
}

export function commanderFor(world, commanderId) {
  return world.commandChain?.commanders?.[commanderId] ?? null;
}

/**
 * Resolve an officer's current location. An officer attached to a unit moves
 * with that unit, so the location is always read from the live world state.
 */
export function commanderLocation(world, commanderId) {
  const commander = commanderFor(world, commanderId);
  if (!commander) return { areaId: null, source: 'unknown', unitId: null };
  const attachedUnitIds = commander.attachedUnitIds?.length
    ? commander.attachedUnitIds
    : commander.attachedUnitId
      ? [commander.attachedUnitId]
      : [];
  const attachedUnit = attachedUnitIds
    .map((unitId) => world.units?.[unitId])
    .find((unit) => unit?.location);
  if (attachedUnit) return { areaId: attachedUnit.location, source: 'attached_unit', unitId: attachedUnit.id };
  return {
    areaId: commander.locationAreaId ?? null,
    source: commander.locationAreaId ? 'command_post' : 'unknown',
    unitId: null,
  };
}

function areaRoute(areas = {}, fromAreaId, toAreaId) {
  if (!fromAreaId || !toAreaId || !areas[fromAreaId] || !areas[toAreaId]) return null;
  if (fromAreaId === toAreaId) return { areaIds: [fromAreaId], travelSeconds: 0 };
  const queue = [{ areaId: fromAreaId, areaIds: [fromAreaId], travelSeconds: 0 }];
  const visited = new Set([fromAreaId]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of areas[current.areaId]?.neighbors ?? []) {
      const nextId = typeof edge === 'string' ? edge : edge.id;
      if (!nextId || visited.has(nextId) || !areas[nextId]) continue;
      const next = {
        areaId: nextId,
        areaIds: [...current.areaIds, nextId],
        travelSeconds: current.travelSeconds + (typeof edge === 'string' ? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds : edge.travelSeconds ?? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds),
      };
      if (nextId === toAreaId) return next;
      visited.add(nextId);
      queue.push(next);
    }
  }
  return null;
}

function commanderIsInChain(world, commanderId, targetCommanderId) {
  let currentId = commanderId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    if (currentId === targetCommanderId) return true;
    visited.add(currentId);
    currentId = commanderFor(world, currentId)?.superiorCommanderId ?? null;
  }
  return false;
}

export function playerCommanderId(world, side) {
  return world.commandChain?.playerCommanderIdsBySide?.[side] ?? null;
}

/** @param {{ side?: string, unitId?: string, recipientCommanderId?: string }} [options] */
export function resolveCommandRecipient(world, options = {}) {
  const { side = 'player', unitId, recipientCommanderId } = options;
  const unit = world.units?.[unitId];
  return recipientCommanderId ?? unit?.commanderId ?? playerCommanderId(world, side);
}

/**
 * Validate that the selected officer can receive an order for the selected
 * unit. An army commander may issue orders to any subordinate in their chain.
 * @param {{ side?: string, issuerCommanderId?: string, recipientCommanderId?: string, unitId?: string }} [options]
 * @returns {{ error: string | null, errorCode?: string | null, errorDetails?: Record<string, unknown> }}
 */
export function authorizeCommandRecipient(world, options = {}) {
  const {
    side = 'player',
    issuerCommanderId,
    recipientCommanderId,
    unitId,
  } = options;
  const chain = world.commandChain;
  if (!chain || Object.keys(chain.commanders ?? {}).length === 0) return { error: null };
  const issuer = commanderFor(world, issuerCommanderId);
  const recipient = commanderFor(world, recipientCommanderId);
  if (!issuer) return battleError(BATTLE_ERROR_CODES.COMMANDER_NOT_FOUND, '没有找到下达命令的统帅。', { commanderId: issuerCommanderId });
  if (!recipient) return battleError(BATTLE_ERROR_CODES.COMMANDER_NOT_FOUND, '没有找到接收命令的军官。', { commanderId: recipientCommanderId });
  if (issuer.side !== side || recipient.side !== side) return battleError(BATTLE_ERROR_CODES.COMMANDER_SIDE_FORBIDDEN, '只能通过本方指挥链下达命令。', { side, issuerCommanderId, recipientCommanderId });
  const unit = world.units?.[unitId];
  if (unit?.commanderId && !commanderIsInChain(world, unit.commanderId, recipientCommanderId)) {
    return battleError(BATTLE_ERROR_CODES.COMMANDER_AUTHORITY, `${recipient.name}当前无权指挥这支部队。`, { unitId, recipientCommanderId });
  }
  return { error: null };
}

/**
 * Calculate whether an order is spoken directly or carried by a messenger.
 * The returned context is safe to expose because it contains only friendly
 * command-chain locations and transport state.
 * @param {{ side?: string, issuerCommanderId?: string, recipientCommanderId?: string, unitId?: string, fallbackDelaySeconds?: number }} [options]
 * @returns {{ error: string | null, errorCode?: string | null, errorDetails?: Record<string, unknown>, mode?: string, delaySeconds?: number, context?: Record<string, unknown> | null }}
 */
export function buildCommandDeliveryPlan(world, options = {}) {
  const {
    side = 'player',
    issuerCommanderId,
    recipientCommanderId,
    unitId,
    fallbackDelaySeconds = 0,
  } = options;
  const chain = world.commandChain;
  if (!chain || Object.keys(chain.commanders ?? {}).length === 0) {
    return {
      error: null,
      mode: 'legacy',
      delaySeconds: normalizeSeconds(fallbackDelaySeconds),
      context: null,
    };
  }
  const recipientId = resolveCommandRecipient(world, { side, unitId, recipientCommanderId });
  const authorityError = authorizeCommandRecipient(world, {
    side,
    issuerCommanderId,
    recipientCommanderId: recipientId,
    unitId,
  });
  if (authorityError.error) return { error: authorityError.error, errorCode: authorityError.errorCode, errorDetails: authorityError.errorDetails };
  const issuerLocation = commanderLocation(world, issuerCommanderId);
  const recipientLocation = commanderLocation(world, recipientId);
  const policy = chain.messengerPolicy ?? createCommandChainState().messengerPolicy;
  const direct = Boolean(issuerLocation.areaId && recipientLocation.areaId && issuerLocation.areaId === recipientLocation.areaId);
  const route = direct ? { areaIds: [issuerLocation.areaId], travelSeconds: 0 } : areaRoute(world.areas, issuerLocation.areaId, recipientLocation.areaId);
  const messengerTravelSeconds = route
    ? Math.max(1, Math.ceil(route.travelSeconds * policy.routeTravelFactor))
    : policy.fallbackDelaySeconds;
  const delaySeconds = direct
    ? policy.directDelaySeconds
    : policy.baseDelaySeconds + messengerTravelSeconds;
  return {
    error: null,
    mode: direct ? 'direct' : 'messenger',
    delaySeconds,
    context: {
      issuerCommanderId,
      recipientCommanderId: recipientId,
      issuerAreaId: issuerLocation.areaId,
      recipientAreaId: recipientLocation.areaId,
      communicationMode: direct ? 'direct' : 'messenger',
      commandPath: route?.areaIds ?? [],
      messenger: direct ? null : {
        status: 'in_transit',
        sentAt: world.simTime,
        estimatedSeconds: delaySeconds,
        route: route?.areaIds ?? [],
      },
    },
  };
}

export function commanderProjection(world, side = 'player') {
  return Object.values(world.commandChain?.commanders ?? {})
    .filter((commander) => commander.side === side)
    .map((commander) => {
      const location = commanderLocation(world, commander.id);
      const commandedUnitIds = Object.values(world.units ?? {})
        .filter((unit) => commanderIsInChain(world, unit.commanderId, commander.id))
        .map((unit) => unit.id);
      return {
        id: commander.id,
        side: commander.side,
        name: commander.name,
        role: commander.role,
        rank: commander.rank,
        superiorCommanderId: commander.superiorCommanderId,
        attachedUnitId: commander.attachedUnitId,
        locationAreaId: location.areaId,
        locationSource: location.source,
        locationStatus: commander.locationStatus,
        isPlayer: commander.isPlayer,
        authority: commander.authority,
        historicalStatus: commander.historicalStatus,
        riskProfile: commander.riskProfile,
        decisionProfile: commander.decisionProfile ? {
          ...commander.decisionProfile,
          terrainFamiliarity: [...(commander.decisionProfile.terrainFamiliarity ?? [])],
          status: 'simulation_variable',
        } : null,
        commandedUnitIds,
      };
    });
}
