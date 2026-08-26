import { createBattleWorld } from './world.js';

function mapById(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

export function createBattleWorldFromScenario(scenarioPackage) {
  const {
    manifest,
    geography,
    terrain,
    terrainFeatures,
    factions,
    commanders,
    units,
    initialWorld,
    intelligenceSources,
    deception,
    objectives,
    endings,
    resolution,
  } = scenarioPackage ?? {};
  if (!manifest?.id || !geography?.areas || !initialWorld?.units) throw new Error('战役剧本缺少 manifest、geography 或 initial-world。');

  const unitDefinitions = mapById(units?.units);
  const commanderDefinitions = mapById(commanders?.commanders);
  const factionDefinitions = factions?.factions ?? [];
  const mergedUnits = initialWorld.units.map((state) => {
    const definition = unitDefinitions.get(state.id);
    if (!definition) throw new Error(`初始状态引用了不存在的部队：${state.id}`);
    if (state.commanderId && !commanderDefinitions.has(state.commanderId)) throw new Error(`部队 ${state.id} 引用了不存在的将领：${state.commanderId}`);
    return { ...definition, ...state };
  });
  const sides = (manifest.sides ?? []).map((side) => ({
    id: side,
    name: factionDefinitions.find((faction) => faction.side === side)?.name ?? side,
  }));

  return createBattleWorld({
    scenarioId: manifest.id,
    seed: initialWorld.seed,
    areas: geography.areas,
    terrainFeatures: terrain?.features ?? terrainFeatures ?? [],
    units: mergedUnits,
    sides,
    intelligenceSources: intelligenceSources?.sources ?? [],
    deceptionActions: deception?.actions ?? [],
    objectives: objectives?.objectives ?? [],
    endings: endings?.endings ?? [],
    resolution,
  });
}
