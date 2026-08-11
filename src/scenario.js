import { getScenario } from './scenarioRegistry.js';

export const SCENARIO_PACKAGE = getScenario('hongguang-jiangnan-1645');
export const SCENARIO = { id: SCENARIO_PACKAGE.manifest.id, title: SCENARIO_PACKAGE.manifest.title, startTurn: SCENARIO_PACKAGE.manifest.startTurn, chapterEndTurn: SCENARIO_PACKAGE.manifest.chapterEndTurn, objective: SCENARIO_PACKAGE.manifest.description };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createScenarioWorld(scenarioOrId = SCENARIO_PACKAGE) {
  const scenario = typeof scenarioOrId === 'string' ? getScenario(scenarioOrId) : scenarioOrId;
  return {
    scenarioId: scenario.manifest.id,
    ruleVersion: scenario.manifest.ruleVersion,
    turn: scenario.manifest.startTurn,
    seed: scenario.initialWorld.seed,
    metrics: clone(scenario.initialWorld.metrics),
    previousEffects: clone(scenario.initialWorld.previousEffects),
    cities: Object.fromEntries(scenario.cities.map(({ name, id: _id, ...city }) => [name, city])),
    officials: Object.fromEntries(scenario.characters.map(({ name, id: _id, ...character }) => [name, character])),
    adviserRelations: Object.fromEntries(scenario.council.map((adviser) => [adviser.id, adviser.relation])),
    factionInfluence: { jiangbei: 58, finance: 56, gentry: 52 },
    intelligence: { points: 3, reports: {} },
    pendingEffects: [],
    flags: [...scenario.initialWorld.flags],
    history: [],
  };
}

function valueAt(context, path) {
  return path.split('.').reduce((value, key) => value?.[key], context);
}

function matchesCondition(condition, context) {
  const actual = valueAt(context, condition.path);
  if (condition.op === 'eq') return actual === condition.value;
  if (condition.op === 'neq') return actual !== condition.value;
  if (condition.op === 'gte') return actual >= condition.value;
  if (condition.op === 'lte') return actual <= condition.value;
  if (condition.op === 'includes') return Array.isArray(actual) && actual.includes(condition.value);
  return false;
}

export function matchesDefinition(definition, context) {
  if (!definition.conditions?.length) return true;
  const results = definition.conditions.map((condition) => matchesCondition(condition, context));
  return definition.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function resolveScenarioEvent(world, action, roll, scenario = SCENARIO_PACKAGE) {
  scenario = world?.scenarioId ? getScenario(world.scenarioId) : scenario;
  const definitions = [...scenario.events, ...scenario.endings]
    .filter((definition) => definition.turn === world.turn)
    .sort((a, b) => a.priority - b.priority);
  const definition = definitions.find((candidate) => matchesDefinition(candidate, { world, action, roll }));
  if (!definition) return null;
  const { conditions: _conditions, match: _match, priority: _priority, turn: _turn, ...event } = definition;
  return clone(event);
}

export function reportsForWorld(world, scenario = SCENARIO_PACKAGE) {
  scenario = world?.scenarioId ? getScenario(world.scenarioId) : scenario;
  const latest = world.history.at(-1)?.events?.findLast((event) => event.report);
  const primary = latest?.report ?? scenario.reports.initial;
  const secondary = world.metrics.defense < 66 ? scenario.reports.defenseWeak : scenario.reports.defenseStable;
  return [primary, secondary].map((report, index) => ({ ...clone(report), id: `${world.turn}-${index}-${report.region}` }));
}

export function currentOutcome(world) {
  return world.history.flatMap((record) => record.events).findLast((event) => event.type === 'chapter_outcome') ?? null;
}

export function stageStatus(world) {
  const scenario = getScenario(world.scenarioId);
  const objectives = scenario.manifest.objectives ?? { targets: { support: 55, defense: 65 }, collapse: { support: 25, defense: 25, treasury: 150 } };
  const labels = { treasury: '国库', grain: '粮草', support: '民心', defense: '防务' };
  const targets = Object.entries(objectives.targets).map(([key, target]) => ({ key, label: labels[key], target, value: world.metrics[key], met: world.metrics[key] >= target }));
  const collapse = Object.entries(objectives.collapse).map(([key, minimum]) => ({ key, label: labels[key], minimum, value: world.metrics[key], breached: world.metrics[key] <= minimum }));
  const remainingTurns = Math.max(0, scenario.manifest.chapterEndTurn - world.turn);
  const collapsed = collapse.find((item) => item.breached) ?? null;
  const chapterEnded = world.turn >= scenario.manifest.chapterEndTurn;
  const allTargetsMet = targets.every((item) => item.met);
  return {
    remainingTurns,
    targets,
    collapse,
    collapsed,
    allTargetsMet,
    state: collapsed ? 'defeat' : chapterEnded ? (allTargetsMet ? 'victory' : 'survived') : 'ongoing',
  };
}
