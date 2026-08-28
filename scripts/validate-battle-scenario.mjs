import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const scenarioDir = resolve(process.argv[2] ?? 'scenarios/changping-260');
const requiredJson = [
  'manifest.json',
  'calendar.json',
  'sources.json',
  'geography.json',
  'terrain.json',
  'routes.json',
  'settlements.json',
  'units.json',
  'commanders.json',
  'factions.json',
  'objectives.json',
  'initial-world.json',
  'initial-beliefs.json',
  'intelligence-sources.json',
  'doctrines.json',
  'deception.json',
  'events.json',
  'endings.json',
  'presentation.json',
];
const optionalJson = ['simulation-parameters.json'];
const errors = [];
const data = {};

function add(message) {
  errors.push(message);
}

function arrayAt(file, key) {
  const value = data[file]?.[key];
  if (!Array.isArray(value)) {
    add(`${file}: ${key} 必须是数组`);
    return [];
  }
  return value;
}

function uniqueIds(items, label) {
  const ids = items.map((item) => item?.id).filter(Boolean);
  if (ids.length !== items.length) add(`${label}: 每项必须包含 id`);
  if (new Set(ids).size !== ids.length) add(`${label}: id 存在重复`);
  return new Set(ids);
}

function validateSourceRefs(items, label, sourceIds) {
  items.forEach((item) => {
    if (item.sourceIds === undefined) return;
    if (!Array.isArray(item.sourceIds)) {
      add(`${label}:${item.id}: sourceIds 必须是数组`);
      return;
    }
    item.sourceIds.forEach((sourceId) => {
      if (!sourceIds.has(sourceId)) add(`${label}:${item.id}: sourceIds 引用了不存在的来源 ${sourceId}`);
    });
  });
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function probability(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

for (const file of requiredJson) {
  try {
    data[file] = JSON.parse(await readFile(resolve(scenarioDir, file), 'utf8'));
  } catch (error) {
    add(`${file}: 无法读取或不是有效 JSON（${error.message}）`);
  }
}
for (const file of optionalJson) {
  try {
    data[file] = JSON.parse(await readFile(resolve(scenarioDir, file), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') add(`${file}: 无法读取或不是有效 JSON（${error.message}）`);
  }
}
try {
  await readFile(resolve(scenarioDir, 'historical-notes.md'), 'utf8');
} catch (error) {
  add(`historical-notes.md: 无法读取（${error.message}）`);
}

if (!errors.length) {
  const manifest = data['manifest.json'];
  const calendar = data['calendar.json'];
  const sourceItems = arrayAt('sources.json', 'sources');
  const areas = arrayAt('geography.json', 'areas');
  const terrain = arrayAt('terrain.json', 'areas');
  const routes = arrayAt('routes.json', 'edges');
  const settlements = arrayAt('settlements.json', 'items');
  const units = arrayAt('units.json', 'units');
  const commanders = arrayAt('commanders.json', 'commanders');
  const factions = arrayAt('factions.json', 'factions');
  const objectives = arrayAt('objectives.json', 'objectives');
  const initialUnits = data['initial-world.json'].units;
  const beliefSides = data['initial-beliefs.json'].sides;
  const intelSources = arrayAt('intelligence-sources.json', 'sources');
  const doctrines = arrayAt('doctrines.json', 'items');
  const deception = arrayAt('deception.json', 'actions');
  const events = arrayAt('events.json', 'events');
  const endings = arrayAt('endings.json', 'endings');
  const simulationParameters = data['simulation-parameters.json'];
  const commandChain = data['commanders.json'].commandChain ?? {};

  for (const key of ['schemaVersion', 'id', 'title', 'ruleVersion', 'eraLabel', 'status']) {
    if (manifest[key] === undefined || manifest[key] === '') add(`manifest.json: 缺少 ${key}`);
  }
  if (manifest.schemaVersion !== 1) add('manifest.json: 当前只支持 schemaVersion=1');
  if (calendar.schemaVersion !== 1) add('calendar.json: 当前只支持 schemaVersion=1');
  if (calendar.system !== 'scenario-relative') add('calendar.json: system 当前只支持 scenario-relative');
  if (!calendar.eraLabel) add('calendar.json: 缺少 eraLabel');
  if (!Number.isInteger(calendar.start?.year) || !Number.isInteger(calendar.start?.month) || !Number.isInteger(calendar.start?.day)) add('calendar.json: start 必须包含整数 year/month/day');
  if (!nonNegativeInteger(calendar.start?.secondOfDay) || calendar.start.secondOfDay >= 86400) add('calendar.json: start.secondOfDay 必须在 0-86399 范围内');
  if (!Array.isArray(calendar.monthLengths) || calendar.monthLengths.length !== 12 || calendar.monthLengths.some((value) => !positiveNumber(value))) add('calendar.json: monthLengths 必须包含 12 个正数');
  if (!Array.isArray(calendar.shichenNames) || calendar.shichenNames.length !== 12 || calendar.shichenNames.some((value) => !value)) add('calendar.json: shichenNames 必须包含 12 个名称');
  if (!positiveNumber(calendar.secondsPerKe) || 7200 % calendar.secondsPerKe !== 0) add('calendar.json: secondsPerKe 必须为可整除一个时辰的正数');
  if (!nonNegativeInteger(calendar.sunriseSecond) || !nonNegativeInteger(calendar.sunsetSecond) || calendar.sunriseSecond >= calendar.sunsetSecond || calendar.sunsetSecond >= 86400) add('calendar.json: 日出日落时间无效');
  if (!['historical_fact', 'historical_estimate', 'scenario_assumption', 'simulation_variable'].includes(calendar.status)) add('calendar.json: status 无效');
  validateSourceRefs([calendar], 'calendar.json', new Set(sourceItems.map((item) => item.id)));
  if (!['draft', 'ready'].includes(manifest.status)) add('manifest.json: status 必须是 draft 或 ready');
  if (!Array.isArray(manifest.sides) || manifest.sides.length < 2) add('manifest.json: sides 至少需要两个阵营');
  const sideIds = new Set(manifest.sides ?? []);
  if (sideIds.size !== (manifest.sides ?? []).length) add('manifest.json: sides 存在重复');

  const sourceIds = uniqueIds(sourceItems, 'sources.json');
  const areaIds = uniqueIds(areas, 'geography.json');
  const terrainIds = new Set(terrain.map((item) => item.areaId).filter(Boolean));
  const terrainFeatures = arrayAt('terrain.json', 'features');
  const unitIds = uniqueIds(units, 'units.json');
  const commanderIds = uniqueIds(commanders, 'commanders.json');
  const factionIds = uniqueIds(factions, 'factions.json');
  const objectiveIds = uniqueIds(objectives, 'objectives.json');
  const intelSourceIds = new Set(intelSources.map((source) => source.id).filter(Boolean));
  uniqueIds(deception, 'deception.json');
  uniqueIds(events, 'events.json');
  uniqueIds(endings, 'endings.json');
  uniqueIds(intelSources, 'intelligence-sources.json');
  uniqueIds(doctrines, 'doctrines.json');

  if (sourceItems.length === 0) add('sources.json: 至少需要一个来源');
  const evidenceGrades = new Set(['S', 'A', 'B', 'C', 'D', 'X']);
  sourceItems.forEach((source) => {
    if (!source.title || !source.type) add(`sources.json:${source.id}: 缺少 title 或 type`);
    if (!evidenceGrades.has(source.evidenceGrade)) add(`sources.json:${source.id}: evidenceGrade 无效`);
  });

  [
    ['geography.json', areas],
    ['terrain.json', terrain],
    ['settlements.json', settlements],
    ['units.json', units],
    ['commanders.json', commanders],
    ['factions.json', factions],
    ['objectives.json', objectives],
    ['intelligence-sources.json', intelSources],
    ['doctrines.json', doctrines],
    ['deception.json', deception],
    ['events.json', events],
    ['endings.json', endings],
  ].forEach(([label, items]) => validateSourceRefs(items, label, sourceIds));

  if (manifest.status === 'ready' && sourceItems.some((source) => source.evidenceGrade === 'X')) add('manifest.json: ready 剧本不能保留 evidenceGrade=X 的来源');
  if (manifest.status === 'ready' && data['presentation.json'].assetStatus === 'placeholder-not-historical') add('presentation.json: ready 剧本不能使用历史地图占位资源');
  const mapConfig = data['presentation.json'].map;
  if (!mapConfig || mapConfig.coordinateSystem !== 'normalized-2d') add('presentation.json: map.coordinateSystem 必须是 normalized-2d');
  if (!mapConfig?.bounds?.x || !mapConfig?.bounds?.y) add('presentation.json: map.bounds 必须包含 x 和 y');

  if (simulationParameters) {
    if (simulationParameters.schemaVersion !== 1) add('simulation-parameters.json: 当前只支持 schemaVersion=1');
    if (simulationParameters.status !== 'experimental') add('simulation-parameters.json: status 必须是 experimental');
    if (simulationParameters.parameterType !== 'scenario_assumption') add('simulation-parameters.json: parameterType 必须是 scenario_assumption');
    if (!positiveNumber(simulationParameters.commandDelaySeconds)) add('simulation-parameters.json: commandDelaySeconds 必须是正数');
    if (simulationParameters.resources !== undefined) {
      if (!simulationParameters.resources || typeof simulationParameters.resources !== 'object' || Array.isArray(simulationParameters.resources)) {
        add('simulation-parameters.json: resources 必须是按阵营划分的对象');
      } else {
        Object.entries(simulationParameters.resources).forEach(([side, ledger]) => {
          if (!sideIds.has(side)) add(`simulation-parameters.json: resources 引用了不存在的阵营 ${side}`);
          if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
            add(`simulation-parameters.json:${side}: resources 必须是对象`);
            return;
          }
          Object.entries(ledger).forEach(([resource, amount]) => {
            if (!nonNegativeInteger(amount)) add(`simulation-parameters.json:${side}.${resource}: 资源数量必须是非负整数`);
          });
        });
      }
    }
    if (!Array.isArray(simulationParameters.initialUnits)) add('simulation-parameters.json: initialUnits 必须是数组');
    const parameterUnitIds = new Set((simulationParameters.initialUnits ?? []).map((unit) => unit.id));
    (simulationParameters.initialUnits ?? []).forEach((unit) => {
      if (!unitIds.has(unit.id)) add(`simulation-parameters.json:${unit.id}: 引用了不存在的部队`);
      if (unit.strengthStatus !== 'scenario_assumption') add(`simulation-parameters.json:${unit.id}: strengthStatus 必须是 scenario_assumption`);
    });
    units.forEach((unit) => {
      if (!parameterUnitIds.has(unit.id)) add(`simulation-parameters.json: 缺少部队 ${unit.id} 的实验初始参数`);
    });
    Object.entries(simulationParameters.routeTravelSeconds ?? {}).forEach(([routeId, seconds]) => {
      if (!positiveNumber(seconds)) add(`simulation-parameters.json:${routeId}: routeTravelSeconds 必须是正数`);
    });
    const scout = simulationParameters.scout;
    if (scout) {
      if (!unitIds.has(scout.targetUnitId)) add('simulation-parameters.json: scout.targetUnitId 引用了不存在的部队');
      if (scout.commandUnitId && !unitIds.has(scout.commandUnitId)) add('simulation-parameters.json: scout.commandUnitId 引用了不存在的部队');
      if (scout.recipientCommanderId && !commanderIds.has(scout.recipientCommanderId)) add('simulation-parameters.json: scout.recipientCommanderId 引用了不存在的将领');
      if (!areaIds.has(scout.reportedAreaId) || !areaIds.has(scout.actualAreaId)) add('simulation-parameters.json: scout 的区域引用无效');
      if (scout.sourceId && !intelSourceIds.has(scout.sourceId)) add('simulation-parameters.json: scout.sourceId 引用了不存在的情报来源');
      if (!positiveNumber(scout.delaySeconds) || !positiveNumber(scout.freshnessSeconds)) add('simulation-parameters.json: scout.delaySeconds 和 freshnessSeconds 必须是正数');
      if (scout.preparationSeconds !== undefined && !nonNegativeInteger(scout.preparationSeconds)) add('simulation-parameters.json: scout.preparationSeconds 必须是非负整数');
      if (scout.cost !== undefined && (!scout.cost || typeof scout.cost !== 'object' || Array.isArray(scout.cost))) add('simulation-parameters.json: scout.cost 必须是对象');
      if (scout.cooldownSeconds !== undefined && !nonNegativeInteger(scout.cooldownSeconds)) add('simulation-parameters.json: scout.cooldownSeconds 必须是非负整数');
      if (scout.exposureProbability !== undefined && !probability(scout.exposureProbability)) add('simulation-parameters.json: scout.exposureProbability 必须在 0-1 范围内');
      if (scout.exposureDelaySeconds !== undefined && !nonNegativeInteger(scout.exposureDelaySeconds)) add('simulation-parameters.json: scout.exposureDelaySeconds 必须是非负整数');
      if (scout.failureReliabilityPenalty !== undefined && !probability(scout.failureReliabilityPenalty)) add('simulation-parameters.json: scout.failureReliabilityPenalty 必须在 0-1 范围内');
    }
    const resolution = simulationParameters.resolution;
    if (resolution) {
      if (resolution.schemaVersion !== 1) add('simulation-parameters.json: resolution.schemaVersion 必须是 1');
      if (resolution.status !== 'experimental') add('simulation-parameters.json: resolution.status 必须是 experimental');
      if (!positiveNumber(resolution.timeLimitSeconds)) add('simulation-parameters.json: resolution.timeLimitSeconds 必须是正数');
      const victory = resolution.victory;
      if (!victory?.id || !victory?.result) add('simulation-parameters.json: resolution.victory 必须包含 id 和 result');
      (victory?.requiredUnitPositions ?? []).forEach((condition) => {
        if (!unitIds.has(condition.unitId) || !areaIds.has(condition.areaId)) add('simulation-parameters.json: resolution.victory.requiredUnitPositions 引用了不存在的部队或区域');
      });
      (victory?.requiredBeliefs ?? []).forEach((condition) => {
        const beliefAreas = Array.isArray(condition.areaIds) ? condition.areaIds : condition.areaId ? [condition.areaId] : [];
        if (!sideIds.has(condition.side) || !unitIds.has(condition.targetUnitId) || beliefAreas.length === 0 || beliefAreas.some((areaId) => !areaIds.has(areaId))) add('simulation-parameters.json: resolution.victory.requiredBeliefs 引用了不存在的阵营、部队或区域');
      });
      (victory?.requiredHoldBeliefs ?? []).forEach((condition) => {
        const beliefAreas = Array.isArray(condition.areaIds) ? condition.areaIds : condition.areaId ? [condition.areaId] : [];
        if (!sideIds.has(condition.side) || !unitIds.has(condition.targetUnitId) || beliefAreas.length === 0 || beliefAreas.some((areaId) => !areaIds.has(areaId))) add('simulation-parameters.json: resolution.victory.requiredHoldBeliefs 引用了不存在的阵营、部队或区域');
      });
      (victory?.requiredTaskEffects ?? []).forEach((condition) => {
        if (!['blockade', 'interdict_supply'].includes(condition.type)) add('simulation-parameters.json: resolution.victory.requiredTaskEffects.type 不受支持');
        if (condition.unitId && !unitIds.has(condition.unitId)) add('simulation-parameters.json: resolution.victory.requiredTaskEffects 引用了不存在的部队');
        if (condition.areaId && !areaIds.has(condition.areaId)) add('simulation-parameters.json: resolution.victory.requiredTaskEffects 引用了不存在的区域');
        if (condition.side && !sideIds.has(condition.side)) add('simulation-parameters.json: resolution.victory.requiredTaskEffects 引用了不存在的阵营');
      });
      if (victory?.requiredHoldSeconds !== undefined && !nonNegativeInteger(victory.requiredHoldSeconds)) add('simulation-parameters.json: resolution.victory.requiredHoldSeconds 必须是非负整数');
      if (!resolution.timeout?.id || !resolution.timeout?.result) add('simulation-parameters.json: resolution.timeout 必须包含 id 和 result');
    }
  }

  areas.forEach((area) => {
    if (!area.name) add(`geography.json:${area.id}: 缺少 name`);
    if (!area.position || !Number.isFinite(area.position.x) || !Number.isFinite(area.position.y)
      || area.position.x < 0 || area.position.x > 100 || area.position.y < 0 || area.position.y > 100) {
      add(`geography.json:${area.id}: position 必须是 0-100 范围内的 x/y 坐标`);
    }
    if (!Array.isArray(area.neighbors)) add(`geography.json:${area.id}: neighbors 必须是数组`);
    (area.neighbors ?? []).forEach((neighbor) => {
      const neighborId = typeof neighbor === 'string' ? neighbor : neighbor.id;
      if (!areaIds.has(neighborId)) add(`geography.json:${area.id}: 引用了不存在的邻接区域 ${neighborId}`);
      if (typeof neighbor !== 'string' && !positiveNumber(neighbor.travelSeconds)) add(`geography.json:${area.id}: travelSeconds 必须是正数`);
    });
  });
  terrain.forEach((item) => {
    if (!areaIds.has(item.areaId)) add(`terrain.json:${item.areaId}: 引用了不存在的区域`);
    if (!item.type) add(`terrain.json:${item.areaId}: 缺少 type`);
  });
  const terrainFeatureIds = uniqueIds(terrainFeatures, 'terrain.json:features');
  const terrainFeatureTypes = new Set(['river', 'mountain-range']);
  terrainFeatures.forEach((feature) => {
    if (!terrainFeatureTypes.has(feature.type)) add(`terrain.json:features:${feature.id}: type 无效`);
    if (!Array.isArray(feature.points) || feature.points.length < 2) add(`terrain.json:features:${feature.id}: points 至少需要两个坐标点`);
    (feature.points ?? []).forEach((point) => {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)
        || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) {
        add(`terrain.json:features:${feature.id}: points 必须是 0-100 范围内的 x/y 坐标`);
      }
    });
  });
  validateSourceRefs(terrainFeatures, 'terrain.json:features', sourceIds);
  areaIds.forEach((areaId) => {
    if (!terrainIds.has(areaId)) add(`terrain.json: 缺少区域 ${areaId} 的地形定义`);
  });
  routes.forEach((edge) => {
    if (!areaIds.has(edge.from) || !areaIds.has(edge.to)) add(`routes.json:${edge.id}: from 或 to 引用了不存在的区域`);
    if (!positiveNumber(edge.travelSeconds)) add(`routes.json:${edge.id}: travelSeconds 必须是正数`);
    if (!positiveNumber(edge.distanceLi)) add(`routes.json:${edge.id}: distanceLi 必须是正数`);
    if (!probability(edge.distanceUncertainty)) add(`routes.json:${edge.id}: distanceUncertainty 必须在 0-1 范围内`);
    if (!['historical_fact', 'historical_estimate', 'scenario_assumption', 'simulation_variable'].includes(edge.distanceStatus)) add(`routes.json:${edge.id}: distanceStatus 无效`);
    if (!['camp-road', 'river-valley-track', 'pass-road', 'valley-road', 'mountain-path', 'supply-road'].includes(edge.roadType)) add(`routes.json:${edge.id}: roadType 无效`);
    if (!['gentle', 'rolling', 'steep'].includes(edge.grade)) add(`routes.json:${edge.id}: grade 无效`);
    if (!['army-column', 'formation', 'detachment'].includes(edge.capacity)) add(`routes.json:${edge.id}: capacity 无效`);
    if (!['low', 'medium', 'high'].includes(edge.concealment)) add(`routes.json:${edge.id}: concealment 无效`);
    if (!['full', 'limited', 'none'].includes(edge.baggageAccess)) add(`routes.json:${edge.id}: baggageAccess 无效`);
    if (!edge.surface) add(`routes.json:${edge.id}: 缺少 surface`);
    if (edge.distanceStatus === 'scenario_assumption' && edge.historicalClaim === true) add(`routes.json:${edge.id}: 剧本假设路线不能标记为 historicalClaim=true`);
    (edge.terrainTransitions ?? []).forEach((transition) => {
      if (!terrainFeatureIds.has(transition.featureId)) add(`routes.json:${edge.id}: terrainTransitions 引用了不存在的地形特征 ${transition.featureId}`);
      const start = transition.startProgress ?? transition.progress;
      const end = transition.endProgress ?? start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end < start) {
        add(`routes.json:${edge.id}: terrainTransitions 的 startProgress/endProgress 必须在 0-1 范围内`);
      }
      if (!transition.terrainType || !transition.transitionType) add(`routes.json:${edge.id}: terrainTransitions 缺少 terrainType 或 transitionType`);
    });
  });
  validateSourceRefs(routes, 'routes.json', sourceIds);
  settlements.forEach((item) => {
    if (!areaIds.has(item.areaId)) add(`settlements.json:${item.id}: areaId 引用了不存在的区域`);
  });

  factions.forEach((faction) => {
    if (!faction.name || !sideIds.has(faction.side)) add(`factions.json:${faction.id}: name 或 side 无效`);
  });
  commanders.forEach((commander) => {
    if (!commander.name || !sideIds.has(commander.side)) add(`commanders.json:${commander.id}: name 或 side 无效`);
    if (commander.sourceIds?.some((sourceId) => !sourceIds.has(sourceId))) add(`commanders.json:${commander.id}: sourceIds 引用了不存在的来源`);
    if (commander.superiorCommanderId && !commanderIds.has(commander.superiorCommanderId)) add(`commanders.json:${commander.id}: superiorCommanderId 引用了不存在的将领`);
    const attachedUnitIds = commander.attachedUnitIds ?? (commander.attachedUnitId ? [commander.attachedUnitId] : []);
    if (attachedUnitIds.some((unitId) => !unitIds.has(unitId))) add(`commanders.json:${commander.id}: attachedUnitId 引用了不存在的部队`);
    if (commander.locationAreaId && !areaIds.has(commander.locationAreaId)) add(`commanders.json:${commander.id}: locationAreaId 引用了不存在的区域`);
    const decisionProfile = commander.decisionProfile;
    if (decisionProfile !== undefined) {
      if (!decisionProfile || typeof decisionProfile !== 'object' || Array.isArray(decisionProfile)) add(`commanders.json:${commander.id}: decisionProfile 必须是对象`);
      else {
        ['competence', 'initiative', 'discipline'].forEach((key) => {
          if (decisionProfile[key] !== undefined && !probability(decisionProfile[key])) add(`commanders.json:${commander.id}: decisionProfile.${key} 必须在 0-1 范围内`);
        });
        if (decisionProfile.riskTolerance !== undefined && !['defensive', 'cautious', 'calculated', 'assertive'].includes(decisionProfile.riskTolerance)) add(`commanders.json:${commander.id}: decisionProfile.riskTolerance 无效`);
        if (decisionProfile.terrainFamiliarity !== undefined && !Array.isArray(decisionProfile.terrainFamiliarity)) add(`commanders.json:${commander.id}: decisionProfile.terrainFamiliarity 必须是数组`);
      }
    }
  });
  if (Object.keys(commandChain).length > 0) {
    if (commandChain.schemaVersion !== 1) add('commanders.json: commandChain.schemaVersion 必须是 1');
    const messengerPolicy = commandChain.messengerPolicy ?? {};
    if (!messengerPolicy || typeof messengerPolicy !== 'object' || Array.isArray(messengerPolicy)) add('commanders.json: commandChain.messengerPolicy 必须是对象');
    else {
      ['baseDelaySeconds', 'fallbackDelaySeconds', 'directDelaySeconds'].forEach((key) => {
        if (!nonNegativeInteger(messengerPolicy[key])) add(`commanders.json: commandChain.messengerPolicy.${key} 必须是非负整数`);
      });
      if (typeof messengerPolicy.routeTravelFactor !== 'number' || !Number.isFinite(messengerPolicy.routeTravelFactor) || messengerPolicy.routeTravelFactor < 0) add('commanders.json: commandChain.messengerPolicy.routeTravelFactor 必须是非负数');
    }
  }
  Object.entries(commandChain.playerCommanderIdsBySide ?? {}).forEach(([side, commanderId]) => {
    const commander = commanders.find((item) => item.id === commanderId);
    if (!sideIds.has(side) || !commanderIds.has(commanderId) || commander?.side !== side) add(`commanders.json: playerCommanderIdsBySide ${side} 引用无效`);
  });
  units.forEach((unit) => {
    if (!sideIds.has(unit.side)) add(`units.json:${unit.id}: side 无效`);
    if (unit.commanderId && !commanderIds.has(unit.commanderId)) add(`units.json:${unit.id}: commanderId 引用了不存在的将领`);
  });

  if (!Number.isInteger(data['initial-world.json'].seed)) add('initial-world.json: seed 必须是整数');
  if (!Array.isArray(initialUnits) || initialUnits.length === 0) add('initial-world.json: units 至少需要一支部队');
  const initialUnitIds = new Set((initialUnits ?? []).map((unit) => unit.id));
  initialUnits?.forEach((unit) => {
    if (!unitIds.has(unit.id)) add(`initial-world.json:${unit.id}: 引用了不存在的部队`);
    if (!areaIds.has(unit.location)) add(`initial-world.json:${unit.id}: location 引用了不存在的区域`);
    if (unit.commanderId && !commanderIds.has(unit.commanderId)) add(`initial-world.json:${unit.id}: commanderId 引用了不存在的将领`);
    ['strength', 'morale', 'fatigue', 'supplyDays'].forEach((field) => {
      if (unit[`${field}Status`] === 'unknown' && typeof unit[field] === 'number' && unit[field] > 0) add(`initial-world.json:${unit.id}: ${field} 标记为 unknown 时不能填入正数`);
    });
  });
  units.forEach((unit) => {
    if (!initialUnitIds.has(unit.id)) add(`initial-world.json: 缺少部队 ${unit.id} 的初始状态`);
  });

  if (!beliefSides || typeof beliefSides !== 'object') add('initial-beliefs.json: sides 必须是对象');
  Object.entries(beliefSides ?? {}).forEach(([side, belief]) => {
    if (!sideIds.has(side)) add(`initial-beliefs.json:${side}: 引用了不存在的阵营`);
    if (JSON.stringify(belief).includes('actualAreaId')) add(`initial-beliefs.json:${side}: 不能包含 actualAreaId 等真实状态字段`);
    (belief.knownUnitIds ?? []).forEach((unitId) => {
      if (!unitIds.has(unitId)) add(`initial-beliefs.json:${side}: knownUnitIds 引用了不存在的部队`);
    });
  });

  intelSources.forEach((source) => {
    if (!sideIds.has(source.side)) add(`intelligence-sources.json:${source.id}: side 无效`);
    if (!Array.isArray(source.areaIds) || source.areaIds.some((areaId) => !areaIds.has(areaId))) add(`intelligence-sources.json:${source.id}: areaIds 无效`);
    if (!source.type) add(`intelligence-sources.json:${source.id}: 缺少 type`);
  });
  doctrines.forEach((doctrine) => {
    if (!sideIds.has(doctrine.side)) add(`doctrines.json:${doctrine.id}: side 无效`);
  });
  deception.forEach((action) => {
    if (!action.name || !action.effect) add(`deception.json:${action.id}: 缺少 name 或 effect`);
    if (action.preparationSeconds !== undefined && !nonNegativeInteger(action.preparationSeconds)) add(`deception.json:${action.id}: preparationSeconds 必须是非负整数`);
    if (action.cost !== undefined && (!action.cost || typeof action.cost !== 'object' || Array.isArray(action.cost))) add(`deception.json:${action.id}: cost 必须是对象`);
    if (action.cooldownSeconds !== undefined && !nonNegativeInteger(action.cooldownSeconds)) add(`deception.json:${action.id}: cooldownSeconds 必须是非负整数`);
    if (action.exposureProbability !== undefined && !probability(action.exposureProbability)) add(`deception.json:${action.id}: exposureProbability 必须在 0-1 范围内`);
    if (action.exposureDelaySeconds !== undefined && !nonNegativeInteger(action.exposureDelaySeconds)) add(`deception.json:${action.id}: exposureDelaySeconds 必须是非负整数`);
    if (action.failureReliabilityPenalty !== undefined && !probability(action.failureReliabilityPenalty)) add(`deception.json:${action.id}: failureReliabilityPenalty 必须在 0-1 范围内`);
    if (action.recipientCommanderId && !commanderIds.has(action.recipientCommanderId)) add(`deception.json:${action.id}: recipientCommanderId 引用了不存在的将领`);
  });
  events.forEach((event) => {
    if (!event.type || !event.title) add(`events.json:${event.id}: 缺少 type 或 title`);
  });
  endings.forEach((ending) => {
    if (!ending.title || !ending.outcome) add(`endings.json:${ending.id}: 缺少 title 或 outcome`);
  });
  if (objectives.length === 0) add('objectives.json: 至少需要一个战略目标');
  objectives.forEach((objective) => {
    if (!objective.name || !sideIds.has(objective.side)) add(`objectives.json:${objective.id}: name 或 side 无效`);
  });
  const presentation = data['presentation.json'];
  if (presentation.renderMode !== 'vector-terrain') add('presentation.json: renderMode 必须是 vector-terrain');
}

if (errors.length) {
  console.error(`战役剧本校验失败（${errors.length} 项）：\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const manifest = data['manifest.json'];
console.log(`战役剧本校验通过：${manifest.title}；${manifest.sides.length} 阵营，${data['geography.json'].areas.length} 区域，${data['units.json'].units.length} 部队，${data['sources.json'].sources.length} 个来源。`);
