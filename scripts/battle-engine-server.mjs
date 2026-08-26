import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHANGPING_PROFILE } from '../src/battlefield/changpingScenario.js';
import { buildCommanderGatewayResponse, handleCommanderRequest } from '../src/battlefield/index.js';

function sessionOptions(profile) {
  return {
    side: 'player',
    commandDelaySeconds: profile.commandDelaySeconds,
    scout: profile.scout,
    sessionOptions: {
      side: 'player',
      mapAsset: profile.mapAsset,
      mapTitle: profile.mapTitle,
      mapNote: profile.mapNote,
      mapConfig: profile.mapConfig,
      mapMarkers: profile.mapMarkers,
      terrainFeatures: profile.mapTerrainFeatures,
    },
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function createBattleEngineServer({ profile = CHANGPING_PROFILE } = {}) {
  const sessions = new Map();
  let nextSessionNumber = 1;
  const options = sessionOptions(profile);

  function createSession() {
    const id = `changping-${String(nextSessionNumber).padStart(4, '0')}`;
    nextSessionNumber += 1;
    const session = { id, world: profile.createWorld() };
    sessions.set(id, session);
    return session;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, schemaVersion: 1, engine: 'headless-battlefield-core' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/sessions') {
        const session = createSession();
        sendJson(response, 201, {
          sessionId: session.id,
          ...buildCommanderGatewayResponse(session.world, { side: options.side, eventCursor: 0, sessionOptions: options.sessionOptions }),
        });
        return;
      }

      const commandMatch = url.pathname.match(/^\/sessions\/([^/]+)\/commands$/);
      if (request.method === 'POST' && commandMatch) {
        const session = sessions.get(commandMatch[1]);
        if (!session) {
          sendJson(response, 404, { error: '会话不存在。' });
          return;
        }
        const body = await readJsonBody(request);
        const result = handleCommanderRequest(session.world, body, options);
        session.world = result.world;
        sendJson(response, 200, {
          sessionId: session.id,
          accepted: result.accepted,
          error: result.error,
          result: result.result ?? null,
          ...result.response,
        });
        return;
      }

      const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (request.method === 'GET' && sessionMatch) {
        const session = sessions.get(sessionMatch[1]);
        if (!session) {
          sendJson(response, 404, { error: '会话不存在。' });
          return;
        }
        const eventCursor = Number(url.searchParams.get('eventCursor') ?? 0);
        sendJson(response, 200, {
          sessionId: session.id,
          ...buildCommanderGatewayResponse(session.world, { side: options.side, eventCursor, sessionOptions: options.sessionOptions }),
        });
        return;
      }
      sendJson(response, 404, { error: '接口不存在。' });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });

  return { server, sessions, createSession };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BATTLE_ENGINE_PORT ?? 4317);
  const { server } = createBattleEngineServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`战场内核网关已启动：http://127.0.0.1:${port}`);
  });
}
