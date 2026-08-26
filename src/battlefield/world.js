import { BATTLEFIELD_CONFIG } from './config.js';

export const BATTLEFIELD_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.world;
export const BATTLEFIELD_SIMULATOR_VERSION = BATTLEFIELD_CONFIG.simulatorVersion;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBeliefState(side, units) {
  return {
    side,
    sightings: {},
    reports: [],
    knownOwnUnitIds: units.filter((unit) => unit.side === side).map((unit) => unit.id),
  };
}

function normalizeArea(area) {
  return {
    id: area.id,
    name: area.name ?? area.id,
    terrain: area.terrain ?? null,
    position: area.position && Number.isFinite(area.position.x) && Number.isFinite(area.position.y)
      ? { x: area.position.x, y: area.position.y }
      : null,
    locationStatus: area.locationStatus ?? null,
    evidenceGrade: area.evidenceGrade ?? null,
    sourceIds: [...(area.sourceIds ?? [])],
    neighbors: (area.neighbors ?? []).map((neighbor) => {
      if (typeof neighbor === 'string') return { id: neighbor, travelSeconds: BATTLEFIELD_CONFIG.defaults.areaTravelSeconds, terrainTransitions: [] };
      return {
        id: neighbor.id,
        travelSeconds: neighbor.travelSeconds ?? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds,
        routeId: neighbor.routeId ?? null,
        terrainTransitions: clone(neighbor.terrainTransitions ?? []),
      };
    }),
  };
}

function normalizeTerrainFeature(feature) {
  return {
    id: feature.id,
    type: feature.type ?? 'unknown',
    name: feature.name ?? feature.id,
    points: (feature.points ?? [])
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: point.x, y: point.y })),
    width: feature.width ?? null,
    status: feature.status ?? 'scenario_assumption',
    evidenceGrade: feature.evidenceGrade ?? null,
    sourceIds: [...(feature.sourceIds ?? [])],
  };
}

function normalizeUnit(unit) {
  return {
    id: unit.id,
    side: unit.side,
    name: unit.name ?? unit.id,
    unitType: unit.unitType ?? 'formation',
    commanderId: unit.commanderId ?? null,
    location: unit.location,
    strength: unit.strength ?? 0,
    strengthUnit: unit.strengthUnit ?? '人',
    strengthStatus: unit.strengthStatus ?? 'simulation_variable',
    initialStrength: unit.initialStrength ?? unit.strength ?? 0,
    morale: unit.morale ?? 50,
    fatigue: unit.fatigue ?? 0,
    supplyDays: unit.supplyDays ?? 0,
    readiness: unit.readiness ?? 1,
    posture: unit.posture ?? 'standard',
    communication: unit.communication ?? 'clear',
    status: unit.status ?? 'active',
    currentOrderId: null,
  };
}

function normalizeDeceptionActions(actions = []) {
  return Object.fromEntries(actions.map((action) => [action.id, clone(action)]));
}

/** @param {import('./contracts').BattleWorld} world */
export function cloneBattleWorld(world) {
  return clone(world);
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {Record<string, unknown>} event
 * @returns {import('./contracts').BattleWorld}
 */
export function appendBattleEvent(world, event) {
  world.eventLog.push({
    id: `event-${world.eventLog.length + 1}`,
    simTime: world.simTime,
    ...clone(event),
  });
  return world;
}

/**
 * Create the authoritative mutable-by-copy battlefield state.
 *
 * @param {import('./contracts').CreateBattleWorldOptions} [options]
 * @returns {import('./contracts').BattleWorld}
 */
export function createBattleWorld({
  scenarioId = 'battle-test',
  seed = 1,
  areas = [],
  terrainFeatures = [],
  units = [],
  sides = [{ id: 'player', name: '我方' }, { id: 'enemy', name: '敌方' }],
  intelligenceSources = [],
  deceptionActions = [],
  objectives = [],
  endings = [],
  resolution = null,
} = {}) {
  const normalizedUnits = units.map(normalizeUnit);
  const sideMap = Object.fromEntries(sides.map((side) => [side.id, { ...side }]));
  const unitMap = Object.fromEntries(normalizedUnits.map((unit) => [unit.id, unit]));
  const beliefMap = Object.fromEntries(Object.keys(sideMap).map((side) => [side, createBeliefState(side, normalizedUnits)]));

  return {
    schemaVersion: BATTLEFIELD_SCHEMA_VERSION,
    simulatorVersion: BATTLEFIELD_SIMULATOR_VERSION,
    scenarioId,
    seed,
    resolution: clone(resolution),
    simTime: 0,
    status: 'running',
    areas: Object.fromEntries(areas.map((area) => [area.id, normalizeArea(area)])),
    terrainFeatures: terrainFeatures.map(normalizeTerrainFeature),
    units: unitMap,
    sides: sideMap,
    intelligenceSources: Object.fromEntries(intelligenceSources.map((source) => [source.id, { ...source }])),
    objectives: clone(objectives),
    endings: clone(endings),
    deception: {
      actions: normalizeDeceptionActions(deceptionActions),
      history: [],
      lastIssuedAtBySide: {},
    },
    orders: [],
    observations: [],
    beliefs: beliefMap,
    engagements: [],
    combat: { intervalSeconds: BATTLEFIELD_CONFIG.defaults.combatIntervalSeconds, lastResolutionAt: 0 },
    logistics: { intervalSeconds: BATTLEFIELD_CONFIG.defaults.supplyTickSeconds, lastSupplyTickAt: 0 },
    ai: {
      intervalSeconds: BATTLEFIELD_CONFIG.defaults.aiIntervalSeconds,
      lastDecisionAt: 0,
      sides: { enemy: { enabled: true, commandDelaySeconds: BATTLEFIELD_CONFIG.defaults.aiCommandDelaySeconds } },
    },
    eventLog: [],
    outcome: null,
  };
}
