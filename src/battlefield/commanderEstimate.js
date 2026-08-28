import { formatHistoricalDuration, formatHistoricalTime } from './calendar.js';

const NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function chineseNumber(value) {
  const number = Math.max(0, Math.round(value));
  if (number < 10) return NUMERALS[number];
  if (number < 20) return `十${number === 10 ? '' : NUMERALS[number - 10]}`;
  if (number < 100) return `${NUMERALS[Math.floor(number / 10)]}十${number % 10 === 0 ? '' : NUMERALS[number % 10]}`;
  return String(number);
}

function roundOutward(value, direction, step = 5) {
  const method = direction === 'down' ? Math.floor : Math.ceil;
  return Math.max(step, method(value / step) * step);
}

export function buildDistanceEstimate(distanceLi, uncertainty = 0.25, status = 'scenario_assumption') {
  if (!Number.isFinite(distanceLi) || distanceLi <= 0) return null;
  const spread = Math.max(0.1, Math.min(0.75, Number(uncertainty) || 0.25));
  const minimumLi = roundOutward(distanceLi * (1 - spread), 'down');
  const maximumLi = Math.max(minimumLi, roundOutward(distanceLi * (1 + spread), 'up'));
  return {
    label: minimumLi === maximumLi ? `约${chineseNumber(minimumLi)}里` : `约${chineseNumber(minimumLi)}至${chineseNumber(maximumLi)}里`,
    precision: 'approximate-range',
    basisStatus: status,
  };
}

export function buildArrivalWindow(calendar, currentSimTime, remainingSeconds, uncertainty = 0.2) {
  if (!calendar || !Number.isFinite(remainingSeconds)) return null;
  const duration = Math.max(0, remainingSeconds);
  const spread = Math.max(60, Math.ceil(duration * Math.max(0.1, Math.min(0.75, uncertainty))));
  const earliest = currentSimTime + Math.max(0, duration - spread);
  const latest = currentSimTime + duration + spread;
  const earliestLabel = formatHistoricalTime(calendar, earliest);
  const latestLabel = formatHistoricalTime(calendar, latest);
  return {
    label: earliestLabel === latestLabel ? `${earliestLabel}前后` : `${earliestLabel}至${latestLabel}之间`,
    durationLabel: `约${formatHistoricalDuration(calendar, duration)}`,
    precision: 'approximate-range',
  };
}

export function routeDistanceEstimate(segments = []) {
  const known = segments.filter((segment) => Number.isFinite(segment.distanceLi) && segment.distanceLi > 0);
  if (known.length === 0) return null;
  const total = known.reduce((sum, segment) => sum + segment.distanceLi, 0);
  const weightedUncertainty = known.reduce((sum, segment) => sum + segment.distanceLi * (segment.distanceUncertainty ?? 0.25), 0) / total;
  const statuses = [...new Set(known.map((segment) => segment.distanceStatus ?? 'scenario_assumption'))];
  return buildDistanceEstimate(total, weightedUncertainty, statuses.length === 1 ? statuses[0] : 'mixed');
}

export function sanitizeRouteSegment(segment = {}) {
  const { travelSeconds, distanceLi, distanceUncertainty, mobilityFactors, ...safe } = segment;
  return {
    ...safe,
    distanceEstimate: buildDistanceEstimate(distanceLi, distanceUncertainty, segment.distanceStatus),
    travelTimeSource: segment.travelTimeSource ?? null,
  };
}
