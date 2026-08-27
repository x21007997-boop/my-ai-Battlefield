import manifest from '../../scenarios/changping-260/manifest.json' with { type: 'json' };
import geography from '../../scenarios/changping-260/geography.json' with { type: 'json' };
import terrain from '../../scenarios/changping-260/terrain.json' with { type: 'json' };
import routes from '../../scenarios/changping-260/routes.json' with { type: 'json' };
import units from '../../scenarios/changping-260/units.json' with { type: 'json' };
import commanders from '../../scenarios/changping-260/commanders.json' with { type: 'json' };
import factions from '../../scenarios/changping-260/factions.json' with { type: 'json' };
import initialWorld from '../../scenarios/changping-260/initial-world.json' with { type: 'json' };
import simulationParameters from '../../scenarios/changping-260/simulation-parameters.json' with { type: 'json' };
import presentation from '../../scenarios/changping-260/presentation.json' with { type: 'json' };
import intelligenceSources from '../../scenarios/changping-260/intelligence-sources.json' with { type: 'json' };
import deception from '../../scenarios/changping-260/deception.json' with { type: 'json' };
import objectives from '../../scenarios/changping-260/objectives.json' with { type: 'json' };
import endings from '../../scenarios/changping-260/endings.json' with { type: 'json' };
import { createBattleWorldFromScenario } from './scenario.js';

const sideMap = { qin: 'player', zhao: 'enemy' };
const terrainLabels = {
  'camp-zone': '营垒区',
  'passage-zone': '关口',
  'river-valley': '河谷',
  'fortified-camp-zone': '壁垒区',
  'approach-zone': '援军通道',
  'highland-zone': '高地',
};

function mapSide(item) {
  return { ...item, side: sideMap[item.side] ?? item.side };
}

function mapResources(resources = {}) {
  return Object.fromEntries(Object.entries(resources).map(([side, ledger]) => [sideMap[side] ?? side, ledger]));
}

function mapCommandChain(commandChain = {}) {
  const playerCommanderIdsBySide = Object.fromEntries(
    Object.entries(commandChain.playerCommanderIdsBySide ?? commandChain.playerCommanderIds ?? {})
      .map(([side, commanderId]) => [sideMap[side] ?? side, commanderId]),
  );
  return {
    ...commandChain,
    playerCommanderIdsBySide,
  };
}

function mapResolution(resolution) {
  if (!resolution) return resolution;
  return {
    ...resolution,
    victory: resolution.victory ? {
      ...resolution.victory,
      side: sideMap[resolution.victory.side] ?? resolution.victory.side,
      requiredBeliefs: (resolution.victory.requiredBeliefs ?? []).map((condition) => ({
        ...condition,
        side: sideMap[condition.side] ?? condition.side,
      })),
      requiredHoldBeliefs: (resolution.victory.requiredHoldBeliefs ?? []).map((condition) => ({
        ...condition,
        side: sideMap[condition.side] ?? condition.side,
      })),
      requiredTaskEffects: (resolution.victory.requiredTaskEffects ?? []).map((condition) => ({
        ...condition,
        side: sideMap[condition.side] ?? condition.side,
      })),
    } : resolution.victory,
    timeout: resolution.timeout ? {
      ...resolution.timeout,
      side: sideMap[resolution.timeout.side] ?? resolution.timeout.side,
    } : resolution.timeout,
  };
}

function routeKey(from, to) {
  return `${from}->${to}`;
}

function routeSeconds(routeTravelSeconds, from, to, fallback) {
  return routeTravelSeconds[routeKey(from, to)]
    ?? routeTravelSeconds[routeKey(to, from)]
    ?? fallback;
}

function routeDefinition(from, to) {
  const direct = routes.edges.find((edge) => edge.from === from && edge.to === to);
  if (direct) return direct;
  const reverse = routes.edges.find((edge) => edge.from === to && edge.to === from);
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

function buildChangpingGamePackage() {
  const routeTravelSeconds = simulationParameters.routeTravelSeconds;
  const terrainByArea = Object.fromEntries(terrain.areas.map((item) => [item.areaId, terrainLabels[item.type] ?? '待审地形']));
  const mappedGeography = {
    areas: geography.areas.map((area) => ({
      ...area,
      terrain: terrainByArea[area.id],
      neighbors: area.neighbors.map((neighbor) => {
        const neighborId = typeof neighbor === 'string' ? neighbor : neighbor.id;
        const fallback = typeof neighbor === 'string' ? 10 : neighbor.travelSeconds;
        const route = routeDefinition(area.id, neighborId);
        return {
          id: neighborId,
          travelSeconds: routeSeconds(routeTravelSeconds, area.id, neighborId, fallback),
          routeId: route?.id ?? null,
          terrainTransitions: route?.terrainTransitions ?? [],
        };
      }),
    })),
  };
  const assumptionByUnit = Object.fromEntries(simulationParameters.initialUnits.map((unit) => [unit.id, unit]));
  const mappedInitialUnits = initialWorld.units.map((unit) => ({ ...unit, ...assumptionByUnit[unit.id], side: sideMap[unit.side] ?? unit.side }));
  return {
    manifest: { ...manifest, id: 'changping-260', sides: ['player', 'enemy'] },
    geography: mappedGeography,
    terrainFeatures: terrain.features,
    units: { units: units.units.map(mapSide) },
    commanders: {
      commanders: commanders.commanders.map(mapSide),
      commandChain: mapCommandChain(commanders.commandChain),
    },
    factions: { factions: factions.factions.map(mapSide) },
    intelligenceSources,
    deception,
    objectives: {
      objectives: objectives.objectives.map((objective) => ({
        ...objective,
        side: sideMap[objective.side] ?? objective.side,
      })),
    },
    endings,
    initialWorld: { ...initialWorld, units: mappedInitialUnits },
    resources: mapResources(simulationParameters.resources),
    resolution: mapResolution(simulationParameters.resolution),
  };
}

const changpingGamePackage = buildChangpingGamePackage();

export const CHANGPING_PROFILE = {
  id: 'changping',
  title: '长平决战前 · 指挥沙盘',
  kicker: '历史背景战役 · 前262—前260年',
  badge: '正式战役关卡',
  dataNote: '沙盘只绘制我方已知旗帜与回传侦报；战斗真值留在内核，敌情报告可能失真。',
  mapTitle: '西营—长平西口—丹水河谷—赵军壁垒',
  mapNote: '历史背景沙盘 · 地标、旗帜与前线报告分层显示',
  mapAsset: null,
  mapConfig: presentation.map,
  mapTerrainFeatures: terrain.features,
  playerName: '秦军态势',
  playerSideLabel: '秦军',
  enemySideLabel: '赵军',
  playerCommanderId: 'bai-qi',
  areas: geography.areas.map((area) => ({
    ...area,
    terrain: terrainLabels[terrain.areas.find((item) => item.areaId === area.id)?.type] ?? '待审地形',
  })),
  mapMarkers: presentation.mapMarkers,
  commandDelaySeconds: simulationParameters.commandDelaySeconds,
  resources: mapResources(simulationParameters.resources),
  commanders: commanders.commanders.map(mapSide),
  commandChain: mapCommandChain(commanders.commandChain),
  scout: simulationParameters.scout,
  deceptionActions: deception.actions,
  createWorld: () => createBattleWorldFromScenario(changpingGamePackage),
};
