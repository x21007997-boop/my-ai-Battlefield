import { createScenarioWorld, resolveScenarioEvent } from './scenario.js';
import { getScenario } from './scenarioRegistry.js';

export const RULE_VERSION = 'hongguang-core-1.1';

export const ACTION_TYPES = {
  TRANSPORT_GRAIN: 'transport_grain',
  DEPLOY_ARMY: 'deploy_army',
  APPOINT_OFFICIAL: 'appoint_official',
};

export const DECISION_POSTURES = {
  cautious: { id: 'cautious', label: '稳妥', costMultiplier: 0.85, benefitMultiplier: 0.8, rollModifier: 0.18, riskLabel: '执行较慢，失败概率降低' },
  balanced: { id: 'balanced', label: '常规', costMultiplier: 1, benefitMultiplier: 1, rollModifier: 0, riskLabel: '成本与收益均衡' },
  aggressive: { id: 'aggressive', label: '激进', costMultiplier: 1.25, benefitMultiplier: 1.4, rollModifier: -0.12, riskLabel: '收益更高，失败代价增加' },
  covert: { id: 'covert', label: '权谋', costMultiplier: 0.95, benefitMultiplier: 1.1, rollModifier: -0.04, riskLabel: '表面成本较低，但有败露风险' },
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

function applyPosture(calculation, postureId) {
  const posture = DECISION_POSTURES[postureId] ?? DECISION_POSTURES.balanced;
  const scale = (effects) => Object.fromEntries(Object.entries(effects).map(([key, value]) => {
    const multiplier = value < 0 ? posture.costMultiplier : posture.benefitMultiplier;
    return [key, Math.sign(value) * Math.max(value === 0 ? 0 : 1, Math.round(Math.abs(value) * multiplier))];
  }));
  return { ...calculation, immediate: scale(calculation.immediate), posture, risk: `${calculation.risk} · ${posture.riskLabel}` };
}

function calculateEffects(world, action, postureId = 'balanced') {
  if (action.type === ACTION_TYPES.TRANSPORT_GRAIN) {
    const amount = action.amount;
    return applyPosture({
      immediate: { treasury: -Math.ceil(amount * 0.55), grain: -amount, support: 2 + Math.floor(amount / 10), defense: 0 },
      delayed: { dueTurn: world.turn + 2, effects: { treasury: -2, grain: 0, support: 2, defense: 0 }, label: `${action.target}赈粮后效` },
      title: `调运${amount}万石粮草赴${action.target}`,
      risk: world.cities[action.target]?.unrest > 55 ? '转运受阻：中' : '转运受阻：低',
    }, postureId);
  }
  if (action.type === ACTION_TYPES.DEPLOY_ARMY) {
    const amount = action.amount;
    return applyPosture({
      immediate: { treasury: -Math.ceil(amount * 0.8), grain: -Math.ceil(amount * 0.45), support: -1, defense: 3 + Math.floor(amount / 8) },
      delayed: { dueTurn: world.turn + 2, effects: { treasury: -3, grain: -2, support: 0, defense: 2 }, label: `${action.target}驻防整编` },
      title: `调${amount}万兵力增援${action.target}`,
      risk: '军饷压力：中',
    }, postureId);
  }
  return applyPosture({
    immediate: { treasury: -3, grain: 0, support: 1, defense: 1 },
    delayed: { dueTurn: world.turn + 2, effects: { treasury: 2, grain: 1, support: 0, defense: 0 }, label: `${action.official}履任成效` },
    title: `派遣${action.official}处置${action.target}事务`,
    risk: '官僚阻力：中',
  }, postureId);
}

export function previewDecision(world, rawDecision, postureId = 'balanced') {
  const parsed = parseDecision(rawDecision, world);
  if (!parsed.valid) return parsed;
  const calculation = calculateEffects(world, parsed.action, postureId);
  return { ...parsed, ...calculation };
}

export function investigateReport(world, report) {
  const next = clone(world);
  next.intelligence ??= { points: 3, reports: {} };
  const existing = next.intelligence.reports[report.region];
  if (existing?.reportTitle === report.title) return { world: next, result: existing, reused: true };
  if (next.intelligence.points < 1) throw new Error('本阶段情报点已经用尽。');
  next.intelligence.points -= 1;
  const roll = seededRoll(next.seed, next.turn, `${report.region}:${report.title}:investigate`);
  const verdict = roll < 0.34 ? '存在隐瞒' : roll < 0.67 ? '部分夸大' : '基本可信';
  const details = {
    '存在隐瞒': `核查发现${report.sender}遗漏了不利细节，原奏报只能作为最低风险估计。`,
    '部分夸大': `多方口供表明灾情属实，但${report.sender}为争取资源放大了紧迫程度。`,
    '基本可信': `驿站记录、仓册与地方口供大体吻合，可以据此制定命令。`,
  };
  const result = { region: report.region, reportTitle: report.title, verdict, detail: details[verdict], verified: true, checkedAtTurn: next.turn };
  next.intelligence.reports[report.region] = result;
  return { world: next, result, reused: false };
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
  const council = getScenario(world.scenarioId).council;
  const reactionFor = (adviserId, kind, tone) => {
    const adviser = council.find((item) => item.id === adviserId);
    const reaction = adviser?.reactions?.[kind];
    return reaction ? { adviserId, tone, ...reaction, effects: reaction.effects } : null;
  };
  if (relations.hubu <= 35) {
    return reactionFor('hubu', 'low', 'obstruction');
  }
  if (relations.local <= 35) {
    return reactionFor('local', 'low', 'obstruction');
  }
  if (relations.shi >= 80 && action.type !== ACTION_TYPES.APPOINT_OFFICIAL) {
    return reactionFor('shi', 'high', 'support');
  }
  return null;
}

function factionEffectsFor(action) {
  if (action.type === ACTION_TYPES.TRANSPORT_GRAIN) return { jiangbei: 4, finance: -4, gentry: 3 };
  if (action.type === ACTION_TYPES.DEPLOY_ARMY) return { jiangbei: 5, finance: -4, gentry: -1 };
  return { jiangbei: action.official === '史可法' ? 3 : 1, finance: 2, gentry: -3 };
}

function resolveFactionShift(influence) {
  if (influence.jiangbei >= 75) return { factionId: 'jiangbei', tone: 'ascendant', title: '江北军政声势日隆', detail: '督师体系逐渐掌握议程，朝廷对前线的依赖继续加深。' };
  if (influence.finance <= 30) return { factionId: 'finance', tone: 'weakened', title: '户部财权难以为继', detail: '连续支出削弱了户部的调度能力，后续命令可能遭遇钱粮掣肘。' };
  if (influence.gentry <= 30) return { factionId: 'gentry', tone: 'weakened', title: '地方士绅转趋离心', detail: '地方利益持续受损，州县配合度开始下降。' };
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

export function resolveTurn(world, rawDecision, postureId = 'balanced') {
  const preview = previewDecision(world, rawDecision, postureId);
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
  const factionEffects = factionEffectsFor(preview.action);
  next.factionInfluence ??= { jiangbei: 58, finance: 56, gentry: 52 };
  Object.entries(factionEffects).forEach(([id, delta]) => {
    next.factionInfluence[id] = clamp((next.factionInfluence[id] ?? 50) + delta, 0, 100);
  });

  if (preview.action.type === ACTION_TYPES.TRANSPORT_GRAIN) {
    next.cities[preview.action.target].grain += Math.round(preview.action.amount * 0.7);
    next.cities[preview.action.target].unrest = clamp(next.cities[preview.action.target].unrest - Math.ceil(preview.action.amount / 4), 0, 100);
  } else if (preview.action.type === ACTION_TYPES.DEPLOY_ARMY) {
    next.cities[preview.action.target].garrison += preview.action.amount;
  } else if (!next.officials[preview.action.official]) {
    next.officials[preview.action.official] = { office: '奉旨差官', location: preview.action.target, loyalty: 70, ability: 65 };
  }

  const intelligenceBonus = next.intelligence?.reports?.[preview.action.target]?.verified ? 0.15 : 0;
  const baseRoll = seededRoll(next.seed, next.turn, rawDecision);
  const roll = Math.min(1, Math.max(0, baseRoll + intelligenceBonus + preview.posture.rollModifier));
  const events = buildTriggeredEvents(next, preview.action, roll);
  let postureEvent = null;
  if (preview.posture.id === 'covert' && baseRoll < 0.38) {
    postureEvent = { type: 'posture_consequence', tone: 'exposed', title: '权谋手段意外败露', detail: '私下运作被政敌捕捉，朝野对命令动机产生怀疑。', effects: { treasury: 0, grain: 0, support: -3, defense: 0 } };
    next.metrics = applyEffects(next.metrics, postureEvent.effects);
    combinedEffects.support = (combinedEffects.support ?? 0) - 3;
    events.push(postureEvent);
  }
  const adviserReaction = resolveAdviserReaction(next, preview.action);
  if (adviserReaction) {
    next.metrics = applyEffects(next.metrics, adviserReaction.effects);
    Object.entries(adviserReaction.effects).forEach(([key, value]) => {
      combinedEffects[key] = (combinedEffects[key] ?? 0) + value;
    });
    events.push({ type: 'adviser_reaction', ...adviserReaction });
  }
  const factionShift = resolveFactionShift(next.factionInfluence);
  if (factionShift) events.push({ type: 'faction_shift', ...factionShift });
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
    factionEffects,
    factionShift,
    intelligenceBonus,
    posture: preview.posture,
    postureEvent,
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
