import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBattleWorldFromScenario } from '../src/battlefield/index.js';

const root = resolve('tests/fixtures/battle-scenario');
const validator = resolve('scripts/validate-battle-scenario.mjs');
const scenarioFileMap = {
  manifest: 'manifest.json',
  calendar: 'calendar.json',
  sources: 'sources.json',
  geography: 'geography.json',
  terrain: 'terrain.json',
  routes: 'routes.json',
  settlements: 'settlements.json',
  units: 'units.json',
  commanders: 'commanders.json',
  factions: 'factions.json',
  objectives: 'objectives.json',
  initialWorld: 'initial-world.json',
  initialBeliefs: 'initial-beliefs.json',
  intelligenceSources: 'intelligence-sources.json',
  doctrines: 'doctrines.json',
  deception: 'deception.json',
  events: 'events.json',
  endings: 'endings.json',
  presentation: 'presentation.json',
};

async function loadFixture() {
  return loadScenario(root);
}

async function loadScenario(directory) {
  const json = async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
  return {
    manifest: await json('manifest.json'),
    calendar: await json('calendar.json'),
    sources: await json('sources.json'),
    geography: await json('geography.json'),
    terrain: await json('terrain.json'),
    routes: await json('routes.json'),
    settlements: await json('settlements.json'),
    units: await json('units.json'),
    commanders: await json('commanders.json'),
    factions: await json('factions.json'),
    objectives: await json('objectives.json'),
    initialWorld: await json('initial-world.json'),
    initialBeliefs: await json('initial-beliefs.json'),
    intelligenceSources: await json('intelligence-sources.json'),
    doctrines: await json('doctrines.json'),
    deception: await json('deception.json'),
    events: await json('events.json'),
    endings: await json('endings.json'),
    presentation: await json('presentation.json'),
  };
}

async function writeScenario(directory, scenario, notes = '# temporary test scenario') {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
  for (const [key, filename] of Object.entries(scenarioFileMap)) await writeFile(resolve(directory, filename), JSON.stringify(scenario[key], null, 2));
  await writeFile(resolve(directory, 'historical-notes.md'), notes);
}

test('validates the battle scenario fixture', () => {
  const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /战役剧本校验通过/);
});

test('loads a validated scenario into the generic battlefield world', async () => {
  const world = createBattleWorldFromScenario(await loadFixture());
  assert.equal(world.scenarioId, 'battle-test-fixture');
  assert.equal(world.calendar.eraLabel, '测试元年');
  assert.equal(world.units['player-wing'].commanderId, 'player-commander');
  assert.equal(world.units['enemy-main'].location, 'ridge');
  assert.equal(world.areas.valley.neighbors[0].travelSeconds, 3);
});

test('validates the Changping draft without turning estimates into facts', async () => {
  const scenarioDir = resolve('scenarios/changping-260');
  const result = spawnSync(process.execPath, [validator, scenarioDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const scenario = await loadScenario(scenarioDir);
  const world = createBattleWorldFromScenario(scenario);
  assert.equal(scenario.manifest.status, 'draft');
  assert.equal(world.units['qin-main'].strength, 0);
  assert.equal(scenario.units.units.find((unit) => unit.id === 'qin-main').strengthStatus, 'unknown');
  assert.equal(world.units['zhao-main'].location, 'zhao-main-camp');
});

test('validator rejects a belief file that leaks real state', async () => {
  const fixture = await loadFixture();
  fixture.initialBeliefs.sides.player.sightings.push({ targetUnitId: 'enemy-main', actualAreaId: 'ridge' });
  const invalidDir = resolve('tests/fixtures/battle-scenario-invalid-belief');
  const { rm } = await import('node:fs/promises');
  await writeScenario(invalidDir, fixture, '# invalid fixture');
  const result = spawnSync(process.execPath, [validator, invalidDir], { encoding: 'utf8' });
  await rm(invalidDir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不能包含 actualAreaId/);
});

test('validator rejects references to missing evidence sources', async () => {
  const fixture = await loadFixture();
  fixture.geography.areas[0].sourceIds = ['missing-source'];
  const invalidDir = resolve('tests/fixtures/battle-scenario-invalid-source');
  const { rm } = await import('node:fs/promises');
  await writeScenario(invalidDir, fixture);
  const result = spawnSync(process.execPath, [validator, invalidDir], { encoding: 'utf8' });
  await rm(invalidDir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /引用了不存在的来源 missing-source/);
});
