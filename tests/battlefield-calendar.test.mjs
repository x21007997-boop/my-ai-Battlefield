import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGPING_PROFILE } from '../src/battlefield/changpingScenario.js';
import { buildCommanderSessionSnapshot, buildHistoricalEstimate, formatHistoricalDuration, formatHistoricalTime, projectHistoricalTime, stepBattle } from '../src/battlefield/index.js';

test('formats the Changping opening as a historical date and shichen', () => {
  const world = CHANGPING_PROFILE.createWorld();
  assert.equal(formatHistoricalTime(world.calendar, 0), '秦昭襄王四十七年 七月十二日 · 巳时正刻');
  assert.equal(projectHistoricalTime(world.calendar, 0).phase, 'day');
});

test('historical time crosses midnight without changing deterministic simTime', () => {
  const world = CHANGPING_PROFILE.createWorld();
  const advanced = stepBattle(world, 1);
  assert.equal(advanced.simTime, 1);
  assert.equal(formatHistoricalTime(world.calendar, 50400), '秦昭襄王四十七年 七月十三日 · 子时正刻');
  assert.equal(projectHistoricalTime(world.calendar, 50400).phase, 'night');
});

test('commander projection exposes formatted time without replacing internal simTime', () => {
  const world = CHANGPING_PROFILE.createWorld();
  const session = buildCommanderSessionSnapshot(world);
  assert.equal(session.simTime, 0);
  assert.equal(session.historicalTime.label, '秦昭襄王四十七年 七月十二日 · 巳时正刻');
  assert.equal(session.historicalTime.calendarStatus, 'scenario_assumption');
});

test('formats double-digit calendar dates with Chinese numerals', () => {
  const calendar = { ...CHANGPING_PROFILE.calendar, start: { year: -260, month: 10, day: 10, secondOfDay: 36000 } };
  assert.equal(formatHistoricalTime(calendar, 0), '秦昭襄王四十七年 十月十日 · 巳时正刻');
});

test('uses historical duration language instead of exposing seconds', () => {
  const calendar = CHANGPING_PROFILE.calendar;
  assert.equal(formatHistoricalDuration(calendar, 120), '少顷');
  assert.equal(formatHistoricalDuration(calendar, 1800), '两刻');
  assert.equal(formatHistoricalDuration(calendar, 10800), '两个时辰');
  assert.deepEqual(buildHistoricalEstimate(calendar, 0, 1800), {
    targetSimTime: 1800,
    timeLabel: '秦昭襄王四十七年 七月十二日 · 巳时六刻',
    durationLabel: '两刻',
    precision: 'approximate',
  });
});
