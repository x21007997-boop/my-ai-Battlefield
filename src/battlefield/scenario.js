import { createBattleWorld } from './world.js';
import { BATTLE_ERROR_CODES, BattleValidationError } from './errors.js';

function mapById(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Adapt a versioned historical scenario package into the generic engine.
 *
 * @param {import('./contracts').BattleScenarioPackage} scenarioPackage
 * @returns {import('./contracts').BattleWorld}
 */
export function createBattleWorldFromScenario(scenarioPackage) {
  const {
    manifest,
    geography,
    terrain,
    terrainFeatures,
    factions,
    commanders,
    commandChain,
    units,
    initialWorld,
    intelligenceSources,
    deception,
    objectives,
    endings,
    resolution,
    resources,
  } = scenarioPackage ?? {};
  if (!manifest?.id || !geography?.areas || !initialWorld?.units) {
    throw new BattleValidationError(BATTLE_ERROR_CODES.SCENARIO_INVALID, '战役剧本缺少 manifest、geography 或 initial-world。');
  }

  const unitDefinitions = mapById(units?.units);
  const commanderDefinitions = mapById(commanders?.commanders);
  const factionDefinitions = factions?.factions ?? [];
  const mergedUnits = initialWorld.units.map((state) => {
    const definition = unitDefinitions.get(state.id);
    if (!definition) throw new BattleValidationError(BATTLE_ERROR_CODES.SCENARIO_UNIT_NOT_FOUND, `初始状态引用了不存在的部队：${state.id}`, { unitId: state.id });
    if (state.commanderId && !commanderDefinitions.has(state.commanderId)) {
      throw new BattleValidationError(BATTLE_ERROR_CODES.SCENARIO_COMMANDER_NOT_FOUND, `部队 ${state.id} 引用了不存在的将领：${state.commanderId}`, { unitId: state.id, commanderId: state.commanderId });
    }
    return { ...definition, ...state };
  });
  const sides = (manifest.sides ?? []).map((side) => ({
    id: side,
    name: String(factionDefinitions.find((faction) => faction.side === side)?.name ?? side),
  }));

  return createBattleWorld({
    scenarioId: manifest.id,
    seed: Number(initialWorld.seed ?? 1),
    areas: geography.areas,
    terrainFeatures: terrain?.features ?? terrainFeatures ?? [],
    units: mergedUnits,
    sides,
    intelligenceSources: intelligenceSources?.sources ?? [],
    deceptionActions: deception?.actions ?? [],
    objectives: objectives?.objectives ?? [],
    endings: endings?.endings ?? [],
    resolution,
    resources,
    commanders: commanders?.commanders ?? [],
    commandChain: commandChain ?? commanders?.commandChain ?? {},
  });
}
