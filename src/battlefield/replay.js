import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, BattleValidationError } from './errors.js';

export const COMMANDER_REPLAY_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.commanderReplay;

const FORBIDDEN_KEYS = new Set([
  'actualAreaId',
  'enemyUnits',
  'combatExchange',
  'rawEnemyTruth',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findForbiddenKey(value, path = 'payload') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const violation = findForbiddenKey(value[index], `${path}[${index}]`);
      if (violation) return violation;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) return `${path}.${key}`;
    const violation = findForbiddenKey(nested, `${path}.${key}`);
    if (violation) return violation;
  }
  return null;
}

export function validateCommanderReplay(snapshot, { scenarioId = null } = {}) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') return ['回放必须是对象。'];
  if (snapshot.schemaVersion !== COMMANDER_REPLAY_SCHEMA_VERSION) {
    errors.push(`不支持的回放协议版本：${snapshot.schemaVersion}`);
  }
  if (typeof snapshot.scenarioId !== 'string' || !snapshot.scenarioId) {
    errors.push('回放缺少 scenarioId。');
  } else if (scenarioId && snapshot.scenarioId !== scenarioId) {
    errors.push(`回放战役不匹配：${snapshot.scenarioId}。`);
  }
  if (!Array.isArray(snapshot.events)) errors.push('回放缺少 events 数组。');
  const disclosure = snapshot.disclosure ?? {};
  if (disclosure.rawEnemyTruthIncluded === true) errors.push('回放包含敌军真值。');
  if (disclosure.combatExchangeIncluded === true) errors.push('回放包含战斗交换真值。');

  let previousSimTime = -1;
  for (const [index, event] of (snapshot.events ?? []).entries()) {
    if (!event || typeof event !== 'object') {
      errors.push(`事件 ${index} 不是对象。`);
      continue;
    }
    if (event.schemaVersion !== COMMANDER_REPLAY_SCHEMA_VERSION) errors.push(`事件 ${index} 协议版本无效。`);
    if (typeof event.type !== 'string' || !event.type) errors.push(`事件 ${index} 缺少 type。`);
    if (!Number.isInteger(event.simTime) || event.simTime < 0) errors.push(`事件 ${index} simTime 无效。`);
    if (event.simTime < previousSimTime) errors.push(`事件 ${index} 的时间顺序无效。`);
    previousSimTime = Math.max(previousSimTime, event.simTime ?? previousSimTime);
    const violation = findForbiddenKey(event.payload ?? {});
    if (violation) errors.push(`事件 ${index} 暴露禁止字段：${violation}。`);
  }
  return errors;
}

export function createCommanderReplayState({ friendlyUnits = [], selectedUnitId = null } = {}) {
  return {
    simTime: 0,
    friendlyUnits: clone(friendlyUnits),
    reportedSignals: [],
    order: {},
    pendingObservation: {},
    selectedUnitId: selectedUnitId ?? friendlyUnits[0]?.id ?? '',
    selectedTargetAreaId: '',
    running: false,
    outcome: null,
    eventCount: 0,
    timeline: [],
    lastEventType: '',
    replayTrajectories: [],
  };
}

function appendReplayTrajectoryPoint(state, unitId, areaId, simTime) {
  if (!unitId || !areaId) return;
  let trajectory = state.replayTrajectories.find((item) => item.unitId === unitId);
  if (!trajectory) {
    trajectory = { unitId, kind: 'replay-trajectory', confidence: 'high', areaIds: [], points: [] };
    state.replayTrajectories.push(trajectory);
  }
  if (trajectory.areaIds.at(-1) === areaId) return;
  trajectory.areaIds.push(areaId);
  trajectory.points.push({ areaId, simTime });
}

function updateUnitArea(state, unitId, areaId) {
  const unitIndex = state.friendlyUnits.findIndex((unit) => unit.id === unitId);
  if (unitIndex < 0) return;
  state.friendlyUnits[unitIndex] = { ...state.friendlyUnits[unitIndex], areaId };
}

function addTimelineEvent(state, event) {
  state.timeline.push(clone(event));
  if (state.timeline.length > 12) state.timeline.shift();
}

export function applyCommanderReplayEvent(state, event) {
  const next = clone(state);
  const payload = event.payload ?? {};
  next.simTime = Math.max(next.simTime, event.simTime ?? next.simTime);
  next.eventCount += 1;
  next.lastEventType = event.type ?? '';
  addTimelineEvent(next, event);

  switch (event.type) {
    case 'order_issued':
      next.order = { ...payload, status: 'transmitting' };
      break;
    case 'order_delivered':
      if (!next.order.unitId || next.order.unitId === payload.unitId) next.order = { ...next.order, ...payload, status: 'executing' };
      break;
    case 'officer_decision':
      if (payload.subjectType === 'order' && (!next.order.id || next.order.id === payload.orderId || next.order.id === payload.subjectId)) {
        next.order = {
          ...next.order,
          officerDecision: payload,
          officerFeedback: payload.rationale ?? null,
          executionDelaySeconds: payload.executionDelaySeconds ?? 0,
          executionPace: payload.executionPace ?? null,
          executionRate: payload.executionRate ?? 1,
          tacticalPosture: payload.tacticalPosture ?? null,
          executionResumeAt: payload.executionDelaySeconds > 0 ? event.simTime + payload.executionDelaySeconds : null,
        };
      }
      break;
    case 'officer_route_changed':
      if (!next.order.id || next.order.id === payload.orderId) {
        next.order = {
          ...next.order,
          route: payload.selectedRoute ?? next.order.route,
          totalTravelSeconds: payload.selectedTravelSeconds ?? next.order.totalTravelSeconds,
          remainingTravelSeconds: payload.selectedTravelSeconds ?? next.order.remainingTravelSeconds,
          movementProgress: 0,
        };
      }
      break;
    case 'officer_delay_completed':
      if (!next.order.id || next.order.id === payload.orderId) next.order = { ...next.order, executionResumeAt: null };
      break;
    case 'unit_departed':
      if (!next.order.unitId || next.order.unitId === payload.unitId) next.order = { ...next.order, departedAt: event.simTime };
      appendReplayTrajectoryPoint(next, payload.unitId, payload.areaId, event.simTime);
      break;
    case 'route_segment_entered':
      if (!next.order.unitId || next.order.unitId === payload.unitId) next.order = { ...next.order, currentRouteSegmentIndex: payload.routeSegmentIndex ?? null };
      break;
    case 'unit_reached_waypoint':
      updateUnitArea(next, payload.unitId, payload.areaId ?? '');
      appendReplayTrajectoryPoint(next, payload.unitId, payload.areaId, event.simTime);
      break;
    case 'unit_encamped':
      updateUnitArea(next, payload.unitId, payload.areaId ?? '');
      break;
    case 'unit_arrived':
      updateUnitArea(next, payload.unitId, payload.areaId ?? payload.targetAreaId ?? '');
      appendReplayTrajectoryPoint(next, payload.unitId, payload.areaId ?? payload.targetAreaId, event.simTime);
      if (!next.order.unitId || next.order.unitId === payload.unitId) next.order = { ...next.order, ...payload, status: 'completed' };
      break;
    case 'unit_entered_terrain':
      next.order = { ...next.order, currentTerrain: {
        featureId: payload.featureId,
        terrainType: payload.terrainType,
        label: payload.label,
        method: payload.method ?? null,
      } };
      break;
    case 'unit_exited_terrain':
      next.order = { ...next.order, currentTerrain: null, lastTerrainTransition: {
        featureId: payload.featureId,
        terrainType: payload.terrainType,
        label: payload.label,
        method: payload.method ?? null,
        crossedAt: event.simTime,
      } };
      break;
    case 'observation_queued':
      next.pendingObservation = { ...payload };
      break;
    case 'report_arrived':
      next.reportedSignals = [
        ...next.reportedSignals,
        {
          id: payload.reportId,
          areaId: payload.reportedAreaId ?? payload.areaId ?? '',
          confidence: payload.confidence ?? 'unknown',
          sourceType: payload.sourceType ?? '前线报告',
          text: payload.text ?? '发现敌情',
          expiresAt: payload.expiresAt ?? null,
          uncertainty: payload.uncertainty ?? null,
        },
      ];
      next.pendingObservation = {};
      break;
    case 'report_expired':
      next.reportedSignals = next.reportedSignals.filter((report) => report.id !== payload.reportId);
      break;
    case 'commander_unit_selected':
      next.selectedUnitId = payload.unitId ?? next.selectedUnitId;
      break;
    case 'commander_target_selected':
      next.selectedTargetAreaId = payload.areaId ?? next.selectedTargetAreaId;
      break;
    case 'simulation_resumed':
      next.running = true;
      break;
    case 'simulation_paused':
      next.running = false;
      break;
    case 'battle_ended':
      next.running = false;
      next.outcome = {
        id: payload.outcomeId ?? event.outcomeId ?? '',
        result: payload.result ?? event.result ?? 'unknown',
        side: payload.side ?? event.side ?? null,
        reason: payload.reason ?? event.reason ?? 'unknown',
      };
      break;
    default:
      break;
  }
  return next;
}

export function replayCommanderEvents(snapshot, { friendlyUnits = [], selectedUnitId = null, untilTime = Infinity } = {}) {
  const errors = validateCommanderReplay(snapshot);
  if (errors.length) throw new BattleValidationError(BATTLE_ERROR_CODES.REPLAY_INVALID, errors.join(' '), { errorCount: errors.length });
  let state = createCommanderReplayState({ friendlyUnits, selectedUnitId });
  for (const event of snapshot.events) {
    if (event.simTime > untilTime) break;
    state = applyCommanderReplayEvent(state, event);
  }
  state.simTime = Math.max(0, Number.isFinite(untilTime) ? Math.floor(untilTime) : state.simTime);
  return state;
}
