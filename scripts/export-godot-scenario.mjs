import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommanderSessionSnapshot, createBattleWorld } from '../src/battlefield/index.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const scenarioDir = resolve(root, 'scenarios/changping-260');
const outputDir = resolve(root, 'godot');

async function json(name) {
  return JSON.parse(await readFile(resolve(scenarioDir, name), 'utf8'));
}

const [manifest, calendar, geography, terrain, routes, units, initialWorld, simulationParameters, presentation, intelligenceSources, deception, objectives, endings, commanders] = await Promise.all([
  json('manifest.json'),
  json('calendar.json'),
  json('geography.json'),
  json('terrain.json'),
  json('routes.json'),
  json('units.json'),
  json('initial-world.json'),
  json('simulation-parameters.json'),
  json('presentation.json'),
  json('intelligence-sources.json'),
  json('deception.json'),
  json('objectives.json'),
  json('endings.json'),
  json('commanders.json'),
]);

const terrainLabels = {
  'camp-zone': '营垒区',
  'passage-zone': '关口',
  'river-valley': '河谷',
  'fortified-camp-zone': '壁垒区',
  'approach-zone': '援军通道',
  'highland-zone': '高地',
};
const terrainByArea = Object.fromEntries(terrain.areas.map((item) => [item.areaId, terrainLabels[item.type] ?? '待审地形']));
const routeOverrides = simulationParameters.routeTravelSeconds ?? {};
const routeDefinitions = routes?.edges ?? [];
const routeKey = (from, to) => `${from}->${to}`;
const routeSeconds = (from, to, fallback) => routeOverrides[routeKey(from, to)]
  ?? routeOverrides[routeKey(to, from)]
  ?? fallback;

function routeDefinition(from, to) {
  const direct = routeDefinitions.find((edge) => edge.from === from && edge.to === to);
  if (direct) return direct;
  const reverse = routeDefinitions.find((edge) => edge.from === to && edge.to === from);
  if (!reverse) return null;
  return {
    ...reverse,
    terrainTransitions: (reverse.terrainTransitions ?? []).map((transition) => ({
      ...transition,
      startProgress: 1 - transition.endProgress,
      endProgress: 1 - transition.startProgress,
    })),
  };
}

const areas = geography.areas.map((area) => ({
  id: area.id,
  name: area.name,
  terrain: terrainByArea[area.id] ?? '待审地形',
  position: area.position,
  locationStatus: area.locationStatus ?? 'unknown',
  evidenceGrade: area.evidenceGrade ?? null,
  neighbors: area.neighbors.map((neighbor) => {
    const neighborId = typeof neighbor === 'string' ? neighbor : neighbor.id;
    const fallback = typeof neighbor === 'string' ? 10 : neighbor.travelSeconds;
    const route = routeDefinition(area.id, neighborId);
    return {
      id: neighborId,
      travelSeconds: routeSeconds(area.id, neighborId, fallback),
      routeId: route?.id ?? null,
      distanceLi: route?.distanceLi ?? null,
      distanceUncertainty: route?.distanceUncertainty ?? null,
      distanceStatus: route?.distanceStatus ?? null,
      roadType: route?.roadType ?? null,
      surface: route?.surface ?? null,
      grade: route?.grade ?? null,
      capacity: route?.capacity ?? null,
      concealment: route?.concealment ?? null,
      baggageAccess: route?.baggageAccess ?? null,
      terrainTransitions: route?.terrainTransitions ?? [],
    };
  }),
}));

const definitions = Object.fromEntries(units.units.map((unit) => [unit.id, unit]));
const states = Object.fromEntries(initialWorld.units.map((unit) => [unit.id, unit]));
const assumptions = Object.fromEntries((simulationParameters.initialUnits ?? []).map((unit) => [unit.id, unit]));
const simulationUnits = initialWorld.units.map((state) => ({
  ...(definitions[state.id] ?? {}),
  ...state,
  ...(assumptions[state.id] ?? {}),
  side: state.side === 'qin' ? 'player' : 'enemy',
  location: state.location,
}));
const simulationCommanders = (commanders.commanders ?? []).map((commander) => ({
  ...commander,
  side: commander.side === 'qin' ? 'player' : commander.side === 'zhao' ? 'enemy' : commander.side,
}));
const simulationCommandChain = {
  ...(commanders.commandChain ?? {}),
  playerCommanderIdsBySide: Object.fromEntries(
    Object.entries(commanders.commandChain?.playerCommanderIdsBySide ?? {}).map(([side, commanderId]) => [side === 'qin' ? 'player' : side === 'zhao' ? 'enemy' : side, commanderId]),
  ),
};
const simulationObjectives = objectives.objectives.map((objective) => ({
  ...objective,
  side: objective.side === 'qin' ? 'player' : objective.side === 'zhao' ? 'enemy' : objective.side,
}));
const simulationResolution = {
  ...simulationParameters.resolution,
  victory: simulationParameters.resolution?.victory ? {
    ...simulationParameters.resolution.victory,
    side: simulationParameters.resolution.victory.side === 'qin' ? 'player' : simulationParameters.resolution.victory.side,
    requiredBeliefs: (simulationParameters.resolution.victory.requiredBeliefs ?? []).map((condition) => ({
      ...condition,
      side: condition.side === 'qin' ? 'player' : condition.side === 'zhao' ? 'enemy' : condition.side,
    })),
    requiredHoldBeliefs: (simulationParameters.resolution.victory.requiredHoldBeliefs ?? []).map((condition) => ({
      ...condition,
      side: condition.side === 'qin' ? 'player' : condition.side === 'zhao' ? 'enemy' : condition.side,
    })),
    requiredTaskEffects: (simulationParameters.resolution.victory.requiredTaskEffects ?? []).map((condition) => ({
      ...condition,
      side: condition.side === 'qin' ? 'player' : condition.side === 'zhao' ? 'enemy' : condition.side,
    })),
  } : simulationParameters.resolution?.victory,
};
const simulationWorld = createBattleWorld({
  scenarioId: manifest.id,
  seed: initialWorld.seed,
  areas,
  terrainFeatures: terrain.features,
  units: simulationUnits,
  commanders: simulationCommanders,
  commandChain: simulationCommandChain,
  sides: [{ id: 'player', name: '秦军' }, { id: 'enemy', name: '赵军' }],
  intelligenceSources: intelligenceSources.sources,
  deceptionActions: deception.actions,
  objectives: simulationObjectives,
  endings: endings.endings,
  resources: Object.fromEntries(Object.entries(simulationParameters.resources ?? {}).map(([side, ledger]) => [side === 'qin' ? 'player' : side === 'zhao' ? 'enemy' : side, ledger])),
  resolution: simulationResolution,
  calendar,
});
const commanderSession = buildCommanderSessionSnapshot(simulationWorld, {
  side: 'player',
  mapAsset: null,
  mapTitle: '西营—长平西口—丹水河谷—赵军壁垒',
  mapNote: '历史背景沙盘 · 地标、旗帜与前线报告分层显示',
  mapConfig: presentation.map,
  mapMarkers: presentation.mapMarkers,
  terrainFeatures: terrain.features,
});
const friendlyUnits = commanderSession.map.friendlyUnits.map((unit) => {
  const definition = definitions[unit.id] ?? {};
  const assumption = assumptions[unit.id] ?? {};
  return {
    ...unit,
    strength: assumption.strength ?? 0,
    strengthUnit: assumption.strengthUnit ?? '战力指数',
    name: definition.name ?? unit.name,
  };
});
const commanderScout = Object.fromEntries(
  Object.entries(simulationParameters.scout ?? {}).filter(([key]) => key !== 'actualAreaId'),
);

const clientScenario = {
  schemaVersion: 1,
  sourceScenarioId: manifest.id,
  title: manifest.title,
  eraLabel: manifest.eraLabel,
  calendar,
  status: manifest.status,
  playability: manifest.playability,
  map: {
    renderMode: presentation.renderMode ?? 'vector-terrain',
    coordinateSystem: presentation.map.coordinateSystem,
    bounds: presentation.map.bounds,
  },
  areas: commanderSession.map.areas,
  routes: commanderSession.map.routes,
  landmarks: commanderSession.map.landmarks,
  terrainFeatures: commanderSession.map.terrainFeatures,
  friendlyUnits,
  commandDelaySeconds: simulationParameters.commandDelaySeconds,
  resources: commanderSession.resources,
  scout: commanderScout,
  deceptionActions: commanderSession.deceptionActions,
  commanders: commanderSession.commanders,
  playerCommanderId: commanderSession.playerCommanderId,
  commandChain: commanderSession.commandChain,
  objectives: simulationObjectives,
  endings: endings.endings,
  resolution: simulationResolution,
  dataNotes: presentation.opening,
  exportNotes: {
    enemyTruthExcluded: true,
    combatTruthExcluded: true,
    sourceProjection: 'buildCommanderSessionSnapshot',
    sourceStateKeys: Object.keys(states),
  },
  commanderSession,
};

await mkdir(resolve(outputDir, 'data'), { recursive: true });
await writeFile(resolve(outputDir, 'data/changping-260.json'), `${JSON.stringify(clientScenario, null, 2)}\n`);
console.log('Godot 战役数据已同步：godot/data/changping-260.json');
