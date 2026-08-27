import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile('godot/data/changping-260.json', 'utf8'));

test('Godot client data is generated from a battle scenario and preserves the map contract', () => {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.map.coordinateSystem, 'normalized-2d');
  assert.equal(data.map.renderMode, 'vector-terrain');
  assert.equal(data.commanderSession.map.backgroundAsset, null);
  assert.equal(data.terrainFeatures.length, 3);
  assert.ok(data.terrainFeatures.some((feature) => feature.type === 'river' && feature.name === '丹水'));
  assert.ok(data.terrainFeatures.some((feature) => feature.type === 'mountain-range'));
  const crossing = data.areas.find((area) => area.id === 'qin-west-camp').neighbors.find((neighbor) => neighbor.id === 'dan-river-valley');
  assert.equal(crossing.terrainTransitions[0].transitionType, 'river-crossing');
  assert.equal(crossing.terrainTransitions[0].method, 'ford');
  assert.equal(data.areas.length, 6);
  assert.equal(data.landmarks.length, 12);
  assert.ok(data.landmarks.some((landmark) => landmark.type === 'city' && landmark.label === '长平城'));
  assert.ok(data.landmarks.some((landmark) => landmark.type === 'granary' && landmark.label === '秦军粮仓'));
  assert.ok(data.landmarks.some((landmark) => landmark.type === 'fortress' && landmark.label === '东侧堡'));
  assert.equal(data.areas.find((area) => area.id === 'dan-river-valley').name, '丹水河谷');
  assert.equal(data.areas.find((area) => area.id === 'zhao-main-camp').name, '赵军壁垒');
  data.areas.forEach((area) => {
    assert.ok(area.position.x >= 0 && area.position.x <= 100);
    assert.ok(area.position.y >= 0 && area.position.y <= 100);
  });
});

test('Godot client data contains only commander-known unit layers', () => {
  assert.deepEqual(data.friendlyUnits.map((unit) => unit.id).sort(), ['qin-detachment', 'qin-main']);
  assert.equal(data.friendlyUnits.some((unit) => unit.id.startsWith('zhao-')), false);
  assert.equal(data.exportNotes.enemyTruthExcluded, true);
  assert.equal(data.exportNotes.combatTruthExcluded, true);
  assert.equal(data.exportNotes.sourceProjection, 'buildCommanderSessionSnapshot');
  assert.equal(data.scout.actualAreaId, undefined);
  assert.equal(data.commanderSession.disclosure.rawEnemyUnitsIncluded, false);
  assert.equal(data.commanderSession.disclosure.actualEnemyPositionsIncluded, false);
  assert.equal(data.commanderSession.deceptionActions.length, 2);
  assert.deepEqual(data.resources, { intelligencePoints: 3, scoutTeams: 2, deceptionAssets: 2 });
  assert.equal(data.scout.preparationSeconds, 30);
  assert.equal(data.playerCommanderId, 'bai-qi');
  assert.equal(data.commanders.find((commander) => commander.id === 'wang-he').attachedUnitId, 'qin-detachment');
  assert.equal(data.commanders.find((commander) => commander.id === 'wang-he').locationAreaId, 'western-gate');
  assert.equal(data.commanders.find((commander) => commander.id === 'wang-he').decisionProfile.riskTolerance, 'calculated');
  assert.equal(data.commanders.find((commander) => commander.id === 'wang-he').decisionProfile.status, 'simulation_variable');
  assert.equal(data.commandChain.messengerPolicy.baseDelaySeconds, 1);
  assert.equal(data.commandChain.messengerPolicy.routeTravelFactor, 0.25);
  assert.deepEqual(data.deceptionActions[0].cost, { intelligencePoints: 1, deceptionAssets: 1 });
  assert.equal(JSON.stringify(data.commanderSession.deceptionActions).includes('actualAreaId'), false);
  assert.equal(data.commanderSession.eventLog.every((event) => event.payload !== undefined), true);
  assert.equal(data.objectives.filter((objective) => objective.side === 'player').length, 2);
  assert.equal(data.resolution.victory.id, 'qin-isolate-relief');
  assert.equal(data.resolution.victory.requiredHoldSeconds, 600);
  assert.equal(data.resolution.victory.requiredTaskEffects[0].type, 'blockade');
  assert.equal(data.endings.some((ending) => ending.id === data.resolution.victory.id), true);
});
