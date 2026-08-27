import { BATTLEFIELD_CONFIG } from './config.js';
import { appendBattleEvent } from './world.js';

export const OFFICER_AI_SCHEMA_VERSION = 1;
export const OFFICER_AI_ENGINE = 'rule-based-officer-v1';

const DEFAULT_PROFILE = Object.freeze({
  competence: 0.7,
  initiative: 0.6,
  discipline: 0.8,
  riskTolerance: 'calculated',
  terrainFamiliarity: [],
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value ?? minimum)));
}

function normalizeProfile(commander = {}) {
  const profile = commander.decisionProfile ?? {};
  return {
    competence: clamp(profile.competence ?? commander.competence ?? DEFAULT_PROFILE.competence),
    initiative: clamp(profile.initiative ?? commander.initiative ?? DEFAULT_PROFILE.initiative),
    discipline: clamp(profile.discipline ?? commander.discipline ?? DEFAULT_PROFILE.discipline),
    riskTolerance: profile.riskTolerance ?? commander.riskProfile ?? DEFAULT_PROFILE.riskTolerance,
    terrainFamiliarity: Array.isArray(profile.terrainFamiliarity) ? [...profile.terrainFamiliarity] : [],
  };
}

function officerFor(world, commanderId) {
  return world.commandChain?.commanders?.[commanderId] ?? null;
}

function officerUnit(world, commander) {
  const attachedUnitIds = commander?.attachedUnitIds?.length
    ? commander.attachedUnitIds
    : commander?.attachedUnitId
      ? [commander.attachedUnitId]
      : [];
  return attachedUnitIds
    .map((unitId) => world.units?.[unitId])
    .find((unit) => unit?.side === commander?.side)
    ?? Object.values(world.units ?? {}).find((unit) => unit.side === commander?.side && unit.commanderId === commander.id)
    ?? null;
}

function terrainTypesFor(order) {
  return [...new Set((order?.terrainTransitions ?? []).map((transition) => transition.terrainType).filter(Boolean))];
}

function terrainLabel(terrainTypes) {
  return terrainTypes
    .map((type) => BATTLEFIELD_CONFIG.terrainLabels[type] ?? type)
    .join('、');
}

/**
 * @param {import('./contracts').BattleWorld} world
 * @param {import('./contracts').BattleCommander} commander
 * @param {Record<string, any>} subject
 * @param {{ subjectType?: string, terrainTypes?: string[] }} options
 */
function baseDecision(world, commander, subject, {
  subjectType,
  terrainTypes = [],
} = {}) {
  const profile = normalizeProfile(commander);
  const unit = subjectType === 'order' ? world.units?.[subject.unitId] : officerUnit(world, commander);
  const unitStatus = unit?.status ?? 'unknown';
  const label = subjectType === 'order' ? '军令' : subject.kind === 'scout' ? '侦查军令' : '计策军令';
  const shared = {
    schemaVersion: OFFICER_AI_SCHEMA_VERSION,
    engine: OFFICER_AI_ENGINE,
    officerId: commander.id,
    officerName: commander.name,
    subjectType,
    subjectId: subject.id,
    confidence: 'medium',
    decision: 'accepted',
    reasonCode: 'within_capability',
    rationale: `${commander.name}判断当前${label}在自身权限和部队状态可承受范围内。`,
    executionDelaySeconds: 0,
    executionPace: 'standard',
    terrainTypes,
    terrainLabel: terrainLabel(terrainTypes),
    profile: {
      competence: profile.competence,
      initiative: profile.initiative,
      discipline: profile.discipline,
      riskTolerance: profile.riskTolerance,
    },
    unitStatus,
  };

  if (!unit || ['destroyed', 'routed'].includes(unitStatus)) {
    return {
      ...shared,
      decision: 'refused',
      confidence: 'high',
      reasonCode: 'unit_unavailable',
      rationale: `${commander.name}拒绝执行：当前受命部队已经无法承担新的行动。`,
    };
  }
  const supplyUnavailable = unit.supplyDays <= 0 && unit.supplyStatus !== 'unknown';
  if (supplyUnavailable || unit.morale <= 30 || unit.readiness <= 0.25) {
    return {
      ...shared,
      decision: 'refused',
      confidence: 'high',
      reasonCode: 'unit_unfit',
      rationale: `${commander.name}拒绝执行：部队补给、士气或整备度已经低于可行动阈值。`,
    };
  }
  if (unit.fatigue >= 75 || unit.morale <= 45 || unit.readiness < 0.55) {
    return {
      ...shared,
      decision: 'delayed',
      confidence: 'high',
      reasonCode: 'reorganize_before_action',
      rationale: `${commander.name}要求先整队休整：当前部队状态不足以立即执行。`,
      executionDelaySeconds: 3,
      executionPace: 'reorganize',
    };
  }

  const unfamiliarTerrain = terrainTypes.some((terrainType) => !profile.terrainFamiliarity.includes(terrainType));
  const cautiousOfficer = ['defensive', 'cautious'].includes(profile.riskTolerance);
  if (terrainTypes.length > 0 && unfamiliarTerrain && cautiousOfficer && profile.competence < 0.82) {
    return {
      ...shared,
      decision: 'modified',
      confidence: 'medium',
      reasonCode: 'terrain_caution',
      rationale: `${commander.name}调整为谨慎行军：${terrainLabel(terrainTypes)}存在额外风险，先降低推进速度。`,
      executionDelaySeconds: 2,
      executionPace: 'cautious',
    };
  }

  if (terrainTypes.length > 0 && profile.initiative >= 0.8 && profile.competence >= 0.8) {
    return {
      ...shared,
      confidence: 'high',
      reasonCode: 'initiative_supported',
      rationale: `${commander.name}判断可以抓住窗口推进，命令按原计划执行。`,
      executionPace: 'rapid',
    };
  }
  return shared;
}

/**
 * Let the responsible officer interpret a delivered movement/task order.
 * This is deterministic on purpose: a future LLM adapter can propose the
 * same decision shape, while the engine remains responsible for applying it.
 */
export function decideOfficerOrder(world, order) {
  const commander = officerFor(world, order?.recipientCommanderId);
  if (!commander) return null;
  return baseDecision(world, commander, order, {
    subjectType: 'order',
    terrainTypes: terrainTypesFor(order),
  });
}

/** Let the responsible officer interpret a delivered reconnaissance/deception action. */
export function decideOfficerStrategy(world, action) {
  const commander = officerFor(world, action?.recipientCommanderId);
  if (!commander) return null;
  const subject = officerUnit(world, commander) ?? world.units?.[action.targetUnitId];
  const decision = baseDecision(world, commander, { ...action, unitId: subject?.id }, {
    subjectType: 'strategy',
    terrainTypes: [],
  });
  if (decision.decision === 'accepted' && action.kind === 'deception' && decision.profile.discipline < 0.55) {
    return {
      ...decision,
      decision: 'modified',
      reasonCode: 'security_check_required',
      rationale: `${commander.name}要求先检查投放渠道，避免计策过早暴露。`,
      executionDelaySeconds: 2,
      executionPace: 'secure',
    };
  }
  return decision;
}

/** Attach a safe officer response to an order/action and append the visible event. */
export function recordOfficerDecision(world, subject, decision) {
  if (!decision) return world;
  const isStrategy = decision.subjectType === 'strategy';
  subject.officerDecision = decision;
  subject.officerFeedback = decision.rationale;
  subject.executionDelaySeconds = decision.executionDelaySeconds;
  subject.executionPace = decision.executionPace;
  const payload = {
    type: 'officer_decision',
    side: subject.side ?? world.units?.[subject.unitId]?.side ?? 'player',
    officerId: decision.officerId,
    officerName: decision.officerName,
    subjectType: decision.subjectType,
    subjectId: decision.subjectId,
    orderId: isStrategy ? null : subject.id,
    actionId: isStrategy ? subject.actionId ?? subject.id : null,
    unitId: subject.unitId ?? subject.targetUnitId ?? null,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    rationale: decision.rationale,
    confidence: decision.confidence,
    executionDelaySeconds: decision.executionDelaySeconds,
    executionPace: decision.executionPace,
    terrainTypes: decision.terrainTypes,
    communicationMode: subject.communicationMode ?? null,
  };
  return appendBattleEvent(world, payload);
}

export function officerDecisionLabel(decision) {
  return {
    accepted: '接受执行',
    modified: '调整执行',
    delayed: '延后执行',
    refused: '拒绝执行',
  }[decision] ?? decision ?? '待判断';
}
