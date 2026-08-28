import { BATTLEFIELD_CONFIG } from './config.js';
import { projectHistoricalTime } from './calendar.js';

const SPEED = Object.freeze({ messenger: 3, scout: 5, detachment: 8, 'relief-force': 10, 'field-army': 12, formation: 11 });
const GRADE = Object.freeze({ level: 1, gentle: 1.08, rolling: 1.22, steep: 1.55 });
const SURFACE = Object.freeze({ 'packed-earth': 1, 'stony-earth': 1.12, 'mixed-earth-ford': 1.3, 'rocky-track': 1.42 });
const WEATHER = Object.freeze({ clear: 1, cloudy: 1.03, rain: 1.25, storm: 1.55, snow: 1.45 });
const LIGHT = Object.freeze({ day: 1, dawn_dusk: 1.12, night: 1.3 });
const BAGGAGE = Object.freeze({ none: 0.92, light: 1, limited: 1.12, full: 1.25, heavy: 1.4 });
const CAPACITY = Object.freeze({ 'army-column': 1, formation: 1.08, detachment: 1.2, messenger: 1 });

function bounded(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function travelerProfile(traveler = {}) {
  const kind = traveler.kind ?? traveler.unitType ?? 'formation';
  const baggage = traveler.baggage ?? (['field-army', 'relief-force'].includes(kind) ? 'full' : kind === 'detachment' ? 'light' : 'none');
  return { kind, fatigue: bounded(traveler.fatigue, 0, 100), baggage };
}

export function movementEnvironment(world = {}) {
  const historicalTime = projectHistoricalTime(world.calendar, world.simTime ?? 0);
  return {
    weather: world.environment?.weather ?? 'clear',
    light: historicalTime?.phase ?? world.environment?.light ?? 'day',
    congestion: world.environment?.congestion ?? 0,
  };
}

/** Deterministic game-time estimate for one structured route edge. */
export function calculateEdgeTravel(edge = {}, traveler = {}, environment = {}) {
  if (!Number.isFinite(edge.distanceLi) || edge.distanceLi <= 0) {
    return {
      travelSeconds: Math.max(0, edge.travelSeconds ?? BATTLEFIELD_CONFIG.defaults.areaTravelSeconds),
      source: 'legacy',
      factors: null,
    };
  }
  const profile = travelerProfile(traveler);
  const factors = {
    grade: GRADE[edge.grade] ?? 1.15,
    surface: SURFACE[edge.surface] ?? 1.1,
    weather: WEATHER[environment.weather] ?? 1,
    light: LIGHT[environment.light] ?? 1,
    fatigue: 1 + profile.fatigue * 0.006,
    baggage: BAGGAGE[profile.baggage] ?? 1.1,
    capacity: CAPACITY[edge.capacity] ?? 1.1,
    congestion: 1 + bounded(environment.congestion, 0, 1) * 0.5,
  };
  if (edge.baggageAccess === 'none' && !['none', 'light'].includes(profile.baggage)) factors.baggage *= 1.35;
  if (edge.baggageAccess === 'limited' && ['full', 'heavy'].includes(profile.baggage)) factors.baggage *= 1.18;
  const baseSecondsPerLi = SPEED[profile.kind] ?? SPEED.formation;
  const multiplier = Object.values(factors).reduce((total, factor) => total * factor, 1);
  return {
    travelSeconds: Math.max(1, Math.ceil(edge.distanceLi * baseSecondsPerLi * multiplier)),
    source: 'mobility-model',
    factors: { ...factors, baseSecondsPerLi },
  };
}
