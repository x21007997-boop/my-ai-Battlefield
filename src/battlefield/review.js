import { BATTLEFIELD_CONFIG } from './config.js';

export const BATTLE_REVIEW_SCHEMA_VERSION = BATTLEFIELD_CONFIG.schemaVersions.battleReview;

const HIDDEN_EVENT_TYPES = new Set(BATTLEFIELD_CONFIG.hiddenEventTypes);

const RESULT_LABELS = {
  'qin-advantage': '秦军达成战役目标',
  victory: '我方取得胜利',
  'strategic-stalemate': '战役陷入僵持',
  'zhao-survival': '赵军成功保存战力',
};

const REASON_LABELS = {
  victory_conditions_met: '满足关卡胜利条件',
  victory_conditions_held: '关键态势已维持到确认窗口',
  time_limit_reached: '达到本局时间上限',
};

function sideMatches(event, side) {
  return !event.side || event.side === side;
}

function visibleEvents(world, side) {
  return (world.eventLog ?? []).filter((event) => {
    if (HIDDEN_EVENT_TYPES.has(event.type) || !sideMatches(event, side)) return false;
    if (['observation_created', 'report_arrived', 'report_expired'].includes(event.type)) {
      return event.observerSide === side;
    }
    return true;
  });
}

function statusForObjective(objective, world, side) {
  if (!world.outcome) return 'in_progress';
  if (world.outcome.side === side) return 'achieved';
  return 'not_achieved';
}

export function buildCommanderObjectiveSnapshot(world, side = 'player') {
  return (world.objectives ?? [])
    .filter((objective) => !objective.side || objective.side === side)
    .map((objective) => ({
      id: objective.id,
      name: objective.name,
      type: objective.type ?? null,
      status: statusForObjective(objective, world, side),
      sourceIds: [...(objective.sourceIds ?? [])],
    }));
}

function eventLabel(event) {
  switch (event.type) {
    case 'order_issued': return '命令已下达';
    case 'order_delivered': return '命令抵达部队';
    case 'unit_arrived': return '部队完成机动';
    case 'unit_entered_terrain': return `部队进入${event.label ?? '地形'}`;
    case 'unit_exited_terrain': return `部队完成${event.label ?? '地形通过'}`;
    case 'observation_created': return '侦察报告出发';
    case 'report_arrived': return '前线情报抵达';
    case 'report_expired': return '过期情报移出沙盘';
    case 'deception_issued': return '计策送入敌方认知';
    case 'victory_hold_started': return '关键态势进入确认窗口';
    case 'victory_hold_broken': return '关键态势中断，需要重新建立';
    case 'ai_decision': return '敌方依据情报采取行动';
    case 'supply_consumed': return '补给持续消耗';
    case 'supply_depleted': return '部队出现断粮压力';
    case 'battle_ended': return '战役结束';
    default: return event.type ?? '未命名事件';
  }
}

function buildMilestones(world, side) {
  return visibleEvents(world, side)
    .filter((event) => [
      'order_issued',
      'unit_entered_terrain',
      'unit_exited_terrain',
      'unit_arrived',
      'report_arrived',
      'deception_issued',
      'ai_decision',
      'supply_depleted',
      'battle_ended',
    ].includes(event.type))
    .slice(-10)
    .map((event) => ({
      simTime: event.simTime,
      type: event.type,
      label: eventLabel(event),
      areaId: event.areaId ?? event.targetAreaId ?? null,
    }));
}

/**
 * Build an audit-safe post-battle summary for one commander side.
 *
 * @param {import('./contracts').BattleWorld} world
 * @param {{ side?: string }} [options]
 */
export function buildCommanderReview(world, { side = 'player' } = {}) {
  const events = visibleEvents(world, side);
  const ownUnitIds = new Set(Object.values(world.units ?? {})
    .filter((unit) => unit.side === side)
    .map((unit) => unit.id));
  const ownOrders = events.filter((event) => event.type === 'order_issued' && ownUnitIds.has(event.unitId));
  const ownReports = events.filter((event) => event.type === 'report_arrived' && event.observerSide === side);
  const ownDeceptions = events.filter((event) => event.type === 'deception_issued' && event.side === side);
  const frontlineReports = ownReports.filter((event) => event.sourceType === 'frontline-report');
  const result = world.outcome?.result ?? 'unknown';
  const reason = world.outcome?.reason ?? 'unknown';

  return {
    schemaVersion: BATTLE_REVIEW_SCHEMA_VERSION,
    scenarioId: world.scenarioId,
    elapsedSeconds: world.simTime,
    outcome: world.outcome ? { ...world.outcome } : null,
    resultLabel: RESULT_LABELS[result] ?? result,
    reasonLabel: REASON_LABELS[reason] ?? reason,
    summary: world.outcome
      ? `${RESULT_LABELS[result] ?? result}，${REASON_LABELS[reason] ?? reason}。`
      : '战役尚未结束。',
    stats: {
      commandCount: ownOrders.length,
      reportCount: ownReports.length,
      frontlineReportCount: frontlineReports.length,
      deceptionCount: ownDeceptions.length,
      eventCount: events.length,
    },
    objectives: buildCommanderObjectiveSnapshot(world, side),
    ownUnits: Object.values(world.units ?? {})
      .filter((unit) => unit.side === side)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        areaId: unit.location,
        status: unit.status,
        strength: unit.strength,
        morale: unit.morale,
        supplyDays: unit.supplyDays,
      })),
    milestones: buildMilestones(world, side),
  };
}
