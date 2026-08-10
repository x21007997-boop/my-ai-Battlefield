import { createScenarioWorld, resolveScenarioEvent } from './scenario.js';
import { getScenario } from './scenarioRegistry.js';

export const RULE_VERSION = 'hongguang-core-1.1';

export const ACTION_TYPES = {
  TRANSPORT_GRAIN: 'transport_grain',
  DEPLOY_ARMY: 'deploy_army',
  APPOINT_OFFICIAL: 'appoint_official',
};

const METRIC_META = {
  treasury: { label: '国库', unit: '万两' },
  grain: { label: '粮草', unit: '万石' },
  support: { label: '民心', unit: '' },
  defense: { label: '有效防务', unit: '' },
};

export function createInitialWorld(scenarioId) {
  return { ...createScenarioWorld(scenarioId), ruleVersion: RULE_VERSION };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min = 0, max = 9999) {
  return Math.min(max, Math.max(min, value));
}

function hashText(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRoll(seed, turn, text) {
  let state = (seed ^ hashText(`${turn}:${text}`)) >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967295;
}

function readAmount(text, fallback) {
  const arabic = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (arabic) return clamp(Math.round(Number(arabic[1])), 1, 100);
  const chinese = [['三十', 30], ['二十', 20], ['十五', 15], ['十', 10], ['八', 8], ['五', 5], ['三', 3]];
  return chinese.find(([word]) => text.includes(`${word}万`))?.[1] ?? fallback;
}

function readRoute(text, cities, defaultSource, defaultTarget) {
  const mentioned = cities
    .map((city) => ({ city, index: text.indexOf(city) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.city);
  const target = mentioned.at(-1) ?? defaultTarget;
  const source = mentioned.length > 1 ? mentioned[0] : defaultSource;
  return { source: source === target ? cities.find((city) => city !== target) ?? defaultSource : source, target };
}

export function parseDecision(rawDecision, world = createInitialWorld()) {
  const text = rawDecision.trim();
  if (!text) return { valid: false, errors: ['决策内容不能为空。'] };

  let type;
  if (/(调粮|粮草|赈粮|籴买|赈济)/.test(text)) type = ACTION_TYPES.TRANSPORT_GRAIN;
  else if (/(调兵|驻军|增援|军队|兵力|布防)/.test(text)) type = ACTION_TYPES.DEPLOY_ARMY;
  else if (/(任命|任免|罢免|派遣|钦差|官员)/.test(text)) type = ACTION_TYPES.APPOINT_OFFICIAL;

  if (!type) {
    return { valid: false, errors: ['当前规则只支持调运粮草、调动军队或任免派遣官员。'] };
  }

  const cities = Object.keys(world.cities);
  const scenario = getScenario(world.scenarioId);
  const defaults = scenario.manifest.actionDefaults;
  const defaultSource = type === ACTION_TYPES.TRANSPORT_GRAIN ? defaults.grainSource : defaults.armySource;
  const defaultTarget = type === ACTION_TYPES.TRANSPORT_GRAIN ? defaults.grainTarget : defaults.armyTarget;
  const { source, target } = readRoute(text, cities, defaultSource, defaultTarget);
  const amount = readAmount(text, type === ACTION_TYPES.APPOINT_OFFICIAL ? 1 : 20);
  const official = Object.keys(world.officials).find((name) => text.includes(name))
    ?? (text.includes('钦差') ? '巡粮钦差' : defaults.official);

  return {
    valid: true,
    action: { id: `turn-${world.turn + 1}-${hashText(text)}`, type, raw: text, source, target, amount, official },
    errors: [],
  };
}

function calculateEffects(world, action) {
  if (action.type === ACTION_TYPES.TRANSPORT_GRAIN) {
    const amount = action.amount;
    return {
      immediate: { treasury: -Math.ceil(amount * 0.55), grain: -amount, support: 2 + Math.floor(amount / 10), defense: 0 },
      delayed: { dueTurn: world.turn + 2, effects: { treasury: -2, grain: 0, support: 2, defense: 0 }, label: `${action.target}赈粮后效` },
      title: `调运${amount}万石粮草赴${action.target}`,
      risk: world.cities[action.target]?.unrest > 55 ? '转运受阻：中' : '转运受阻：低',
    };
  }
  if (action.type === ACTION_TYPES.DEPLOY_ARMY) {
    const amount = action.amount;
    return {
      immediate: { treasury: -Math.ceil(amount * 0.8), grain: -Math.ceil(amount * 0.45), support: -1, defense: 3 + Math.floor(amount / 8) },
      delayed: { dueTurn: world.turn + 2, effects: { treasury: -3, grain: -2, support: 0, defense: 2 }, label: `${action.target}驻防整编` },
      title: `调${amount}万兵力增援${action.target}`,
      risk: '军饷压力：中',
    };
  }
  return {
    immediate: { treasury: -3, grain: 0, support: 1, defense: 1 },
    delayed: { dueTurn: world.turn + 2, effects: { treasury: 2, grain: 1, support: 0, defense: 0 }, label: `${action.official}履任成效` },
    title: `派遣${action.official}处置${action.target}事务`,
    risk: '官僚阻力：中',
  };
}

export function previewDecision(world, rawDecision) {
  const parsed = parseDecision(rawDecision, world);
  if (!parsed.valid) return parsed;
  const calculation = calculateEffects(world, parsed.action);
  return { ...parsed, ...calculation };
}

function applyEffects(metrics, effects) {
  const next = { ...metrics };
  Object.entries(effects).forEach(([key, delta]) => {
    next[key] = clamp((next[key] ?? 0) + delta, 0, key === 'support' || key === 'defense' ? 100 : 9999);
  });
  return next;
}

function relationEffectsFor(action) {
  if (action.type === ACTION_TYPES.TRANSPORT_GRAIN) return { shi: 5, hubu: -2, local: 2 };
  if (action.type === ACTION_TYPES.DEPLOY_ARMY) return { shi: 4, hubu: -3, local: -1 };
  return { shi: action.official === '史可法' ? 3 : -1, hubu: 2, local: -4 };
}

function resolveAdviserReaction(world, action) {
  const relations = world.adviserRelations;
  if (relations.hubu <= 35) {
    return { adviserId: 'hubu', tone: 'obstruction', title: '户部封驳诏令', detail: '户部以钱粮无着为由拖延发文，执行成本继续增加。', effects: { treasury: -3, grain: 0, support: 0, defense: 0 } };
  }
  if (relations.local <= 35) {
    return { adviserId: 'local', tone: 'obstruction', title: '地方阳奉阴违', detail: '地方官员表面奉旨，实际拖延筹措，引发新的民间猜疑。', effects: { treasury: 0, grain: 0, support: -2, defense: 0 } };
  }
  if (relations.shi >= 80 && action.type !== ACTION_TYPES.APPOINT_OFFICIAL) {
    return { adviserId: 'shi', tone: 'support', title: '史可法补陈方略', detail: '史可法主动补齐军民协同章程，使本次命令执行得更为稳妥。', effects: { treasury: 0, grain: 0, support: 1, defense: 2 } };
  }
  return null;
}

function buildTriggeredEvents(world, action, roll) {
  const events = [{ type: 'decision_resolved', title: '诏令已经颁行', detail: action.raw }];
  if (action.type === ACTION_TYPES.TRANSPORT_GRAIN) {
    events.push(roll > 0.28
      ? { type: 'regional_report', title: `${action.target}米价开始回落`, detail: '首批粮船抵达，饥民骚动暂缓。' }
      : { type: 'complication', title: '运河粮船遇阻', detail: '地方胥吏索费，部分粮船滞留途中。' });
  }
  if (action.type === ACTION_TYPES.DEPLOY_ARMY) events.push({ type: 'military_report', title: `${action.target}防线重整`, detail: '新到兵力已开始接管沿江要津。' });
  if (action.type === ACTION_TYPES.APPOINT_OFFICIAL) events.push({ type: 'court_report', title: '新任差官领命', detail: `${action.official}已领敕书，启程赴任。` });
  return events;
}

export function resolveTurn(world, rawDecision) {
  const preview = previewDecision(world, rawDecision);
  if (!preview.valid) throw new Error(preview.errors.join(' '));

  const next = clone(world);
  const turnBefore = next.turn;
  const due = next.pendingEffects.filter((item) => item.dueTurn === turnBefore + 1);
  const dueEffects = due.reduce((sum, item) => {
    Object.entries(item.effects).forEach(([key, value]) => { sum[key] = (sum[key] ?? 0) + value; });
    return sum;
  }, {});
  const combinedEffects = { ...preview.immediate };
  Object.entries(dueEffects).forEach(([key, value]) => { combinedEffects[key] = (combinedEffects[key] ?? 0) + value; });

  next.turn += 1;
  next.metrics = applyEffects(next.metrics, combinedEffects);
  next.previousEffects = combinedEffects;
  next.pendingEffects = next.pendingEffects.filter((item) => item.dueTurn !== next.turn);
  next.pendingEffects.push(preview.delayed);
  const relationEffects = relationEffectsFor(preview.action);
  next.adviserRelations ??= { shi: 68, hubu: 56, local: 52 };
  Object.entries(relationEffects).forEach(([id, delta]) => {
    next.adviserRelations[id] = clamp((next.adviserRelations[id] ?? 50) + delta, 0, 100);
  });

  if (preview.action.type === ACTION_TYPES.TRANSPORT_GRAIN) {
    next.cities[preview.action.target].grain += Math.round(preview.action.amount * 0.7);
    next.cities[preview.action.target].unrest = clamp(next.cities[preview.action.target].unrest - Math.ceil(preview.action.amount / 4), 0, 100);
  } else if (preview.action.type === ACTION_TYPES.DEPLOY_ARMY) {
    next.cities[preview.action.target].garrison += preview.action.amount;
  } else if (!next.officials[preview.action.official]) {
    next.officials[preview.action.official] = { office: '奉旨差官', location: preview.action.target, loyalty: 70, ability: 65 };
  }

  const roll = seededRoll(next.seed, next.turn, rawDecision);
  const events = buildTriggeredEvents(next, preview.action, roll);
  const adviserReaction = resolveAdviserReaction(next, preview.action);
  if (adviserReaction) {
    next.metrics = applyEffects(next.metrics, adviserReaction.effects);
    Object.entries(adviserReaction.effects).forEach(([key, value]) => {
      combinedEffects[key] = (combinedEffects[key] ?? 0) + value;
    });
    events.push({ type: 'adviser_reaction', ...adviserReaction });
  }
  const scenarioEvent = resolveScenarioEvent(next, preview.action, roll);
  if (scenarioEvent) {
    next.metrics = applyEffects(next.metrics, scenarioEvent.effects);
    Object.entries(scenarioEvent.effects).forEach(([key, value]) => {
      combinedEffects[key] = (combinedEffects[key] ?? 0) + value;
    });
    next.previousEffects = combinedEffects;
    next.flags.push(...scenarioEvent.addFlags.filter((flag) => !next.flags.includes(flag)));
    events.push(scenarioEvent);
  }
  const record = {
    id: preview.action.id,
    ruleVersion: RULE_VERSION,
    seed: next.seed,
    turnBefore,
    turnAfter: next.turn,
    rawDecision,
    action: preview.action,
    effects: combinedEffects,
    relationEffects,
    adviserReaction,
    delayedResolved: due.map((item) => item.label),
    events,
  };
  next.history.push(record);
  return { world: next, record, preview };
}

export function metricsForView(world, icons = {}) {
  return Object.entries(METRIC_META).map(([key, meta]) => ({
    key,
    ...meta,
    value: world.metrics[key],
    delta: world.previousEffects[key] ?? 0,
    icon: icons[key],
  }));
}

export function serializeSnapshot(world) {
  return JSON.stringify({ savedAt: new Date().toISOString(), world });
}
