import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateEdgeTravel } from '../src/battlefield/mobility.js';
import { findRoute } from '../src/battlefield/orders.js';

const road = {
  id: 'east',
  distanceLi: 10,
  grade: 'gentle',
  surface: 'packed-earth',
  capacity: 'army-column',
  baggageAccess: 'full',
  travelSeconds: 999,
};

test('structured distance replaces the legacy fixed duration', () => {
  const result = calculateEdgeTravel(road, { unitType: 'field-army', fatigue: 0 }, { weather: 'clear', light: 'day' });
  assert.equal(result.source, 'mobility-model');
  assert.notEqual(result.travelSeconds, road.travelSeconds);
  assert.equal(result.factors.baseSecondsPerLi, 12);
});

test('messengers, scouts and baggage formations cross the same road at different speeds', () => {
  const messenger = calculateEdgeTravel(road, { kind: 'messenger', baggage: 'none' }).travelSeconds;
  const scout = calculateEdgeTravel(road, { kind: 'scout', baggage: 'light' }).travelSeconds;
  const formation = calculateEdgeTravel(road, { unitType: 'field-army', fatigue: 30, baggage: 'full' }).travelSeconds;
  assert.ok(messenger < scout);
  assert.ok(scout < formation);
});

test('terrain, weather, darkness, fatigue and congestion compound deterministically', () => {
  const clear = calculateEdgeTravel(road, { unitType: 'detachment', fatigue: 0 }, { weather: 'clear', light: 'day', congestion: 0 });
  const obstructed = calculateEdgeTravel(
    { ...road, grade: 'steep', surface: 'rocky-track', baggageAccess: 'none' },
    { unitType: 'field-army', fatigue: 60, baggage: 'heavy' },
    { weather: 'rain', light: 'night', congestion: 0.8 },
  );
  assert.ok(obstructed.travelSeconds > clear.travelSeconds * 3);
  assert.deepEqual(obstructed, calculateEdgeTravel(
    { ...road, grade: 'steep', surface: 'rocky-track', baggageAccess: 'none' },
    { unitType: 'field-army', fatigue: 60, baggage: 'heavy' },
    { weather: 'rain', light: 'night', congestion: 0.8 },
  ));
});

test('route finding preserves legacy scenarios without structured distance', () => {
  const areas = {
    west: { neighbors: [{ id: 'east', travelSeconds: 7 }] },
    east: { neighbors: [{ id: 'west', travelSeconds: 7 }] },
  };
  assert.equal(findRoute(areas, 'west', 'east').travelSeconds, 7);
});
