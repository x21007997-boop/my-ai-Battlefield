export const BATTLE_CALENDAR_SCHEMA_VERSION = 1;

const DEFAULT_SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const DEFAULT_MONTH_LENGTHS = [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29];
const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七'];

export function normalizeBattleCalendar(calendar = null) {
  if (!calendar) return null;
  return {
    schemaVersion: calendar.schemaVersion ?? BATTLE_CALENDAR_SCHEMA_VERSION,
    system: calendar.system ?? 'scenario-relative',
    eraLabel: calendar.eraLabel ?? '',
    start: {
      year: Number(calendar.start?.year ?? 0),
      month: Number(calendar.start?.month ?? 1),
      day: Number(calendar.start?.day ?? 1),
      secondOfDay: Number(calendar.start?.secondOfDay ?? 0),
    },
    monthLengths: [...(calendar.monthLengths ?? DEFAULT_MONTH_LENGTHS)],
    shichenNames: [...(calendar.shichenNames ?? DEFAULT_SHICHEN)],
    secondsPerKe: Number(calendar.secondsPerKe ?? 900),
    sunriseSecond: Number(calendar.sunriseSecond ?? 21600),
    sunsetSecond: Number(calendar.sunsetSecond ?? 64800),
    status: calendar.status ?? 'scenario_assumption',
    sourceIds: [...(calendar.sourceIds ?? [])],
  };
}

function advanceDate(calendar, elapsedDays) {
  let year = calendar.start.year;
  let month = calendar.start.month;
  let day = calendar.start.day;
  for (let index = 0; index < elapsedDays; index += 1) {
    day += 1;
    const monthLength = calendar.monthLengths[month - 1] ?? 30;
    if (day <= monthLength) continue;
    day = 1;
    month += 1;
    if (month <= calendar.monthLengths.length) continue;
    month = 1;
    year += 1;
  }
  return { year, month, day };
}

function dateNumber(value) {
  if (value < 10) return `${CHINESE_NUMERALS[value - 1] ?? value}`;
  if (value === 10) return '十';
  if (value < 20) return `十${value === 10 ? '' : CHINESE_NUMERALS[value - 11]}`;
  if (value < 30) return `二十${value === 20 ? '' : CHINESE_NUMERALS[value - 21]}`;
  return `三十${value === 30 ? '' : CHINESE_NUMERALS[value - 31]}`;
}

function keLabel(secondWithinShichen, secondsPerKe) {
  const ke = Math.floor(secondWithinShichen / secondsPerKe);
  if (ke === 0) return '初刻';
  if (ke === 4) return '正刻';
  return `${CHINESE_NUMERALS[Math.min(ke, 7) - 1] ?? ke}刻`;
}

export function projectHistoricalTime(calendarInput, simTime = 0) {
  const calendar = normalizeBattleCalendar(calendarInput);
  if (!calendar) return null;
  const absoluteSeconds = Math.max(0, Math.floor(simTime)) + calendar.start.secondOfDay;
  const elapsedDays = Math.floor(absoluteSeconds / 86400);
  const secondOfDay = absoluteSeconds % 86400;
  const date = advanceDate(calendar, elapsedDays);
  const shifted = (secondOfDay + 3600) % 86400;
  const shichenIndex = Math.floor(shifted / 7200);
  const secondWithinShichen = shifted % 7200;
  const daylight = secondOfDay >= calendar.sunriseSecond && secondOfDay < calendar.sunsetSecond;
  return {
    ...date,
    secondOfDay,
    elapsedDays,
    shichen: calendar.shichenNames[shichenIndex] ?? DEFAULT_SHICHEN[shichenIndex],
    ke: Math.floor(secondWithinShichen / calendar.secondsPerKe),
    keLabel: keLabel(secondWithinShichen, calendar.secondsPerKe),
    daylight,
    phase: daylight ? 'day' : 'night',
    secondsUntilSunset: daylight ? calendar.sunsetSecond - secondOfDay : null,
  };
}

export function formatHistoricalTime(calendarInput, simTime = 0) {
  const calendar = normalizeBattleCalendar(calendarInput);
  const moment = projectHistoricalTime(calendar, simTime);
  if (!calendar || !moment) return null;
  return `${calendar.eraLabel} ${dateNumber(moment.month)}月${dateNumber(moment.day)}日 · ${moment.shichen}时${moment.keLabel}`.trim();
}
