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
    adviserRelations: { shi: 68, hubu: 56, local: 52 },
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
