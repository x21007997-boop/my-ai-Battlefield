import { BATTLEFIELD_CONFIG } from './config.js';
import { BATTLE_ERROR_CODES, battleError } from './errors.js';
import { commanderFor, commanderProjection, playerCommanderId } from './commandChain.js';

export const INSTRUCTION_INTERPRETER_SCHEMA_VERSION = 1;

const TASK_KEYWORDS = Object.freeze({
  guard: ['警戒', '戒备'],
  cover: ['掩护', '保护'],
  blockade: ['封锁', '堵住'],
  decoy: ['诱敌', '诱出'],
  interdict_supply: ['截粮', '断粮', '粮道'],
  retreat: ['撤退', '退却', '回撤'],
});

function findByText(items, text, labelOf = (item) => item.name) {
  return [...items]
    .filter((item) => {
      const label = String(labelOf(item) ?? '');
      return label && text.includes(label);
    })
    .sort((left, right) => String(labelOf(right)).length - String(labelOf(left)).length)[0] ?? null;
}

function areaFromText(world, text) {
  const namedArea = Object.values(world.areas ?? {})
    .filter((area) => {
      const name = String(area.name ?? '');
      const shortName = name.split('（')[0].trim();
      return (name && text.includes(name)) || (shortName && text.includes(shortName));
    })
    .sort((left, right) => String(right.name ?? '').length - String(left.name ?? '').length)[0] ?? null;
  return namedArea
    ?? Object.values(world.areas ?? {}).find((area) => text.includes(area.id))
    ?? null;
}

function actionFromText(world, text) {
  return findByText(Object.values(world.deception?.actions ?? {}), text, (action) => action.name)
    ?? Object.values(world.deception?.actions ?? {})[0]
    ?? null;
}

function taskFromText(text) {
  for (const [type, keywords] of Object.entries(TASK_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) return type;
  }
  return null;
}

function unitForCommander(world, commanderId, side) {
  const commander = commanderFor(world, commanderId);
  const attached = commander?.attachedUnitIds?.length
    ? commander.attachedUnitIds
    : commander?.attachedUnitId
      ? [commander.attachedUnitId]
      : [];
  const attachedUnit = attached.map((unitId) => world.units?.[unitId]).find((unit) => unit?.side === side);
  if (attachedUnit) return attachedUnit;
  return Object.values(world.units ?? {}).find((unit) => unit.side === side && unit.commanderId === commanderId) ?? null;
}

function findUnit(world, text, side) {
  return findByText(Object.values(world.units ?? {}).filter((unit) => unit.side === side), text, (unit) => unit.name)
    ?? (text.includes('主力') ? Object.values(world.units ?? {}).find((unit) => unit.side === side && unit.unitType === 'field-army') : null)
    ?? null;
}

function findCommander(world, text, side) {
  return findByText(commanderProjection(world, side), text, (commander) => commander.name)
    ?? (text.includes('副将') ? commanderProjection(world, side).find((commander) => commander.superiorCommanderId) : null)
    ?? null;
}

function isScout(text) {
  return ['侦察', '侦查', '斥候', '探查', '打探'].some((keyword) => text.includes(keyword));
}

function isDeception(text) {
  return ['计策', '谣言', '欺骗', '佯动', '假情报', '诱骗'].some((keyword) => text.includes(keyword));
}

function isHold(text) {
  return ['坚守', '固守', '防守', '原地不动'].some((keyword) => text.includes(keyword));
}

/**
 * Convert commander-written Chinese into an engine command. This is a stable
 * local interpreter contract; an LLM adapter can replace it later while
 * keeping the same `{ command, confidence, rationale }` shape.
 */
export function interpretCommanderInstruction(world, {
  side = 'player',
  text = '',
  defaultUnitId = null,
  defaultRecipientCommanderId = null,
} = {}) {
  const rawText = String(text ?? '').trim();
  if (!rawText) return { command: null, ...battleError(BATTLE_ERROR_CODES.COMMAND_REQUIRED, '军令内容不能为空。') };

  const explicitCommander = findCommander(world, rawText, side);
  const explicitUnit = findUnit(world, rawText, side);
  const explicitArea = areaFromText(world, rawText);
  const action = isDeception(rawText) ? actionFromText(world, rawText) : null;
  const taskType = taskFromText(rawText);
  const type = isScout(rawText) ? 'scout' : action ? 'deception' : isHold(rawText) ? 'hold' : taskType ?? 'move';
  const fallbackUnit = explicitUnit ?? (defaultUnitId ? world.units?.[defaultUnitId] : null);
  const recipientId = explicitCommander?.id
    ?? defaultRecipientCommanderId
    ?? fallbackUnit?.commanderId
    ?? playerCommanderId(world, side);
  const recipientUnit = explicitCommander ? unitForCommander(world, recipientId, side) : null;
  const targetUnit = explicitUnit ?? recipientUnit ?? fallbackUnit;
  const command = {
    type,
    rawText,
    issuerCommanderId: playerCommanderId(world, side),
    recipientCommanderId: recipientId,
  };

  if (type === 'deception') {
    if (!action) return { command: null, ...battleError(BATTLE_ERROR_CODES.DECEPTION_NOT_FOUND, '没有识别出要施行的计策。') };
    command.actionId = action.id;
    if (targetUnit?.id) command.targetUnitId = targetUnit.id;
  } else if (type === 'scout') {
    if (targetUnit?.id) command.commandUnitId = targetUnit.id;
  } else {
    if (!targetUnit?.id) return { command: null, ...battleError(BATTLE_ERROR_CODES.UNIT_NOT_FOUND, '没有识别出要受命的部队，请写出部队或副将姓名。') };
    command.unitId = targetUnit.id;
    if (type !== 'hold') {
      if (!explicitArea) return { command: null, ...battleError(BATTLE_ERROR_CODES.ORDER_TARGET_REQUIRED, '没有识别出目标区域，请写出“向丹水河谷推进”这类目标。') };
      command.targetAreaId = explicitArea.id;
    }
    if (type === 'guard' && explicitArea) command.targetAreaId = explicitArea.id;
  }

  const confidence = explicitCommander && explicitArea && (targetUnit || type === 'scout')
    ? 'high'
    : explicitCommander || explicitArea || targetUnit
      ? 'medium'
      : 'low';
  return {
    command,
    error: null,
    errorCode: null,
    errorDetails: {},
    interpretation: {
      schemaVersion: INSTRUCTION_INTERPRETER_SCHEMA_VERSION,
      engine: 'rule-based-v1',
      intent: type,
      intentLabel: type === 'move' ? '机动' : type === 'hold' ? '坚守' : type === 'scout' ? '侦察' : type === 'deception' ? '计策' : BATTLEFIELD_CONFIG.taskLabels[type] ?? type,
      recipientCommanderId: recipientId,
      recipientCommanderName: commanderFor(world, recipientId)?.name ?? null,
      unitId: targetUnit?.id ?? null,
      unitName: targetUnit?.name ?? null,
      targetAreaId: explicitArea?.id ?? null,
      targetAreaName: explicitArea?.name ?? null,
      confidence,
    },
  };
}
