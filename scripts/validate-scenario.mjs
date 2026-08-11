import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInitialWorld, resolveTurn } from '../src/simulation.js';
import { currentOutcome } from '../src/scenario.js';

const scenarioDir = resolve(process.argv[2] ?? 'scenarios/hongguang-1645');
const requiredFiles = ['manifest.json', 'initial-world.json', 'cities.json', 'characters.json', 'council.json', 'factions.json', 'presentation.json', 'events.json', 'endings.json', 'reports.json'];
const errors = [];
const data = {};

for (const file of requiredFiles) {
  try {
    data[file] = JSON.parse(await readFile(resolve(scenarioDir, file), 'utf8'));
  } catch (error) {
    errors.push(`${file}: 无法读取或不是有效 JSON（${error.message}）`);
  }
}

if (!errors.length) {
  const manifest = data['manifest.json'];
  const cities = data['cities.json'];
  const characters = data['characters.json'];
  const council = data['council.json'];
  const presentation = data['presentation.json'];
  const factions = data['factions.json'];
  const definitions = [...data['events.json'], ...data['endings.json']];
  const reports = data['reports.json'];
  const cityNames = new Set(cities.map((city) => city.name));
  const metricKeys = new Set(['treasury', 'grain', 'support', 'defense']);

  for (const key of ['schemaVersion', 'id', 'title', 'startTurn', 'chapterEndTurn', 'ruleVersion']) {
    if (manifest[key] === undefined || manifest[key] === '') errors.push(`manifest.json: 缺少 ${key}`);
  }
  for (const [label, items] of [['城市', cities], ['人物', characters], ['事件', definitions]]) {
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) errors.push(`${label}: id 存在重复`);
  }
  characters.forEach((character) => {
    if (!cityNames.has(character.location)) errors.push(`characters.json:${character.id}: location “${character.location}” 不存在`);
  });
  if (new Set(council.map((adviser) => adviser.id)).size !== council.length) errors.push('council.json: id 存在重复');
  for (const requiredId of ['shi', 'hubu', 'local']) if (!council.some((adviser) => adviser.id === requiredId)) errors.push(`council.json: 缺少规则角色 ${requiredId}`);
  council.forEach((adviser) => {
    for (const key of ['name', 'office', 'stance', 'text', 'image']) if (!adviser[key]) errors.push(`council.json:${adviser.id}: 缺少 ${key}`);
    if (typeof adviser.relation !== 'number' || adviser.relation < 0 || adviser.relation > 100) errors.push(`council.json:${adviser.id}: relation 必须是 0—100`);
    Object.values(adviser.reactions ?? {}).forEach((reaction) => {
      if (!reaction.title || !reaction.detail || !reaction.effects) errors.push(`council.json:${adviser.id}: reaction 缺少 title、detail 或 effects`);
    });
  });
  for (const key of ['eraLabel', 'meetingTitle', 'archiveTitle']) if (!presentation[key]) errors.push(`presentation.json: 缺少 ${key}`);
  if (!Array.isArray(presentation.opening) || presentation.opening.length < 3) errors.push('presentation.json: opening 至少需要三幕');
  presentation.opening?.forEach((card, index) => {
    for (const key of ['eyebrow', 'title', 'body']) if (!card[key]) errors.push(`presentation.json: opening[${index}] 缺少 ${key}`);
  });
  if (new Set(factions.map((faction) => faction.id)).size !== factions.length) errors.push('factions.json: id 存在重复');
  for (const requiredId of ['jiangbei', 'finance', 'gentry']) if (!factions.some((faction) => faction.id === requiredId)) errors.push(`factions.json: 缺少规则势力 ${requiredId}`);
  factions.forEach((faction) => {
    for (const key of ['name', 'short']) if (!faction[key]) errors.push(`factions.json:${faction.id}: 缺少 ${key}`);
    if (typeof faction.influence !== 'number' || faction.influence < 0 || faction.influence > 100) errors.push(`factions.json:${faction.id}: influence 必须是 0—100`);
    if (faction.shift && (!['gte', 'lte'].includes(faction.shift.direction) || typeof faction.shift.threshold !== 'number' || !faction.shift.title || !faction.shift.detail)) errors.push(`factions.json:${faction.id}: shift 配置不完整`);
  });
  Object.entries(reports).forEach(([id, report]) => {
    if (!cityNames.has(report.region)) errors.push(`reports.json:${id}: region “${report.region}” 不存在`);
  });
  definitions.forEach((definition) => {
    if (!Number.isInteger(definition.turn)) errors.push(`${definition.id}: turn 必须是整数`);
    if (!definition.title || !definition.detail || !definition.type) errors.push(`${definition.id}: 缺少 title、detail 或 type`);
    if (!Array.isArray(definition.conditions)) errors.push(`${definition.id}: conditions 必须是数组`);
    if (!Array.isArray(definition.addFlags)) errors.push(`${definition.id}: addFlags 必须是数组`);
    Object.entries(definition.effects ?? {}).forEach(([key, value]) => {
      if (!metricKeys.has(key)) errors.push(`${definition.id}: 未知指标 ${key}`);
      if (typeof value !== 'number') errors.push(`${definition.id}: effects.${key} 必须是数字`);
    });
    if (definition.report && !cityNames.has(definition.report.region)) errors.push(`${definition.id}: report.region “${definition.report.region}” 不存在`);
    definition.conditions?.forEach((condition, index) => {
      if (!['eq', 'neq', 'gte', 'lte', 'includes'].includes(condition.op)) errors.push(`${definition.id}: conditions[${index}] 使用未知操作符 ${condition.op}`);
      if (!/^(world|action|roll)\./.test(condition.path)) errors.push(`${definition.id}: conditions[${index}] 路径必须从 world、action 或 roll 开始`);
    });
  });
  const turns = new Set(definitions.map((definition) => definition.turn));
  turns.forEach((turn) => {
    if (!definitions.some((definition) => definition.turn === turn && definition.conditions.length === 0)) errors.push(`第 ${turn} 回合没有兜底事件，可能出现无事件路线`);
  });
}

if (!errors.length) {
  const manifest = data['manifest.json'];
  const defaults = manifest.actionDefaults;
  const commands = [`调拨二十万石粮草赈济${defaults.grainTarget}`, `调动五万兵力增援${defaults.armyTarget}`, `派遣${defaults.official}前往${defaults.armyTarget}查办`];
  const outcomes = new Set();
  for (const first of commands) for (const second of commands) for (const third of commands) {
    let world = createInitialWorld(manifest.id);
    for (const command of [first, second, third]) world = resolveTurn(world, command).world;
    const outcome = currentOutcome(world)?.outcome;
    if (outcome) outcomes.add(outcome);
  }
  for (const expected of data['endings.json'].map((ending) => ending.outcome)) {
    if (!outcomes.has(expected)) errors.push(`endings.json: 结局“${expected}”在 27 条基础决策组合中不可达`);
  }
}

if (errors.length) {
  console.error(`剧本校验失败（${errors.length} 项）：\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`剧本校验通过：${data['manifest.json'].title}；${data['cities.json'].length} 城市，${data['characters.json'].length} 人物，${data['council.json'].length} 幕僚，${data['factions.json'].length} 派系，${data['events.json'].length} 事件，${data['endings.json'].length} 结局。`);
