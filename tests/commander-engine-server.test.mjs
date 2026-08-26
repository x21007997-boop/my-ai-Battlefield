import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleEngineServer } from '../scripts/battle-engine-server.mjs';

test('battle engine server exposes a safe commander session gateway', async () => {
  const { server } = createBattleEngineServer();
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
