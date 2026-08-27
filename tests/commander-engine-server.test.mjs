import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBattleEngineServer } from '../scripts/battle-engine-server.mjs';

test('battle engine server exposes a safe commander session gateway', async () => {
  const { server } = createBattleEngineServer({ storageDir: null });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.engine, 'headless-battlefield-core');

    const created = await fetch(`${baseUrl}/sessions`, { method: 'POST' }).then((response) => response.json());
    assert.ok(created.sessionId);
    assert.equal(created.session.disclosure.actualEnemyPositionsIncluded, false);

    const moved = await fetch(`${baseUrl}/sessions/${created.sessionId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventCursor: 0, command: { type: 'move', unitId: 'qin-main', targetAreaId: 'dan-river-valley' } }),
    }).then((response) => response.json());
    assert.equal(moved.accepted, true);
    assert.equal(moved.events[0].payload.actualAreaId, undefined);
    assert.equal(moved.events[0].payload.unitId, 'qin-main');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('battle engine server persists and resumes a commander session', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'battle-engine-session-'));
  const startServer = () => createBattleEngineServer({ storageDir });
  const closeServer = (server) => new Promise((resolve) => server.close(resolve));
  let firstServer;
  let secondServer;
  try {
    firstServer = startServer();
    await new Promise((resolve) => firstServer.server.listen(0, '127.0.0.1', resolve));
    const firstUrl = `http://127.0.0.1:${firstServer.server.address().port}`;
    const created = await fetch(`${firstUrl}/sessions`, { method: 'POST' }).then((response) => response.json());
    const advanced = await fetch(`${firstUrl}/sessions/${created.sessionId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventCursor: 0, command: { type: 'advance', seconds: 12 } }),
    }).then((response) => response.json());
    assert.equal(advanced.session.simTime, 12);
    await closeServer(firstServer.server);

    secondServer = startServer();
    await new Promise((resolve) => secondServer.server.listen(0, '127.0.0.1', resolve));
    const secondUrl = `http://127.0.0.1:${secondServer.server.address().port}`;
    const resumed = await fetch(`${secondUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeSessionId: created.sessionId }),
    }).then((response) => response.json());
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.sessionId, created.sessionId);
    assert.equal(resumed.session.simTime, 12);
    assert.equal((await fetch(`${secondUrl}/health`).then((response) => response.json())).persistence, 'filesystem');

    const fresh = await fetch(`${secondUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newSession: true }),
    }).then((response) => response.json());
    assert.equal(fresh.resumed, false);
    assert.notEqual(fresh.sessionId, created.sessionId);
  } finally {
    if (firstServer?.server.listening) await closeServer(firstServer.server);
    if (secondServer?.server.listening) await closeServer(secondServer.server);
    rmSync(storageDir, { recursive: true, force: true });
  }
});
