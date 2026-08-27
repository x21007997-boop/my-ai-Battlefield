import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHANGPING_PROFILE } from '../src/battlefield/changpingScenario.js';
import { buildCommanderGatewayResponse, handleCommanderRequest } from '../src/battlefield/index.js';

const SESSION_STORE_SCHEMA_VERSION = 1;

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, path);
}

function createSessionStore(storageDir) {
  if (!storageDir) {
    return {
      enabled: false,
      load: () => ({ sessions: new Map(), nextSessionNumber: 1 }),
      save: () => {},
    };
  }

  const rootDir = resolve(storageDir);
  const sessionsDir = join(rootDir, 'sessions');
  const manifestPath = join(rootDir, 'manifest.json');

  function ensureDirectories() {
    mkdirSync(sessionsDir, { recursive: true });
  }

  function load() {
    const sessions = new Map();
    const manifest = readJsonFile(manifestPath);
    let nextSessionNumber = Number.isInteger(manifest?.nextSessionNumber) ? manifest.nextSessionNumber : 1;
    if (!existsSync(sessionsDir)) return { sessions, nextSessionNumber };

    for (const entry of readdirSync(sessionsDir)) {
      if (!entry.endsWith('.json')) continue;
      const record = readJsonFile(join(sessionsDir, entry));
      if (record?.schemaVersion !== SESSION_STORE_SCHEMA_VERSION || typeof record.sessionId !== 'string' || !record.world) continue;
      sessions.set(record.sessionId, { id: record.sessionId, world: record.world });
      const suffix = record.sessionId.match(/-(\d+)$/);
      if (suffix) nextSessionNumber = Math.max(nextSessionNumber, Number(suffix[1]) + 1);
    }
    return { sessions, nextSessionNumber };
  }

  function save(session, nextSessionNumber) {
    ensureDirectories();
    const sessionPath = join(sessionsDir, `${basename(session.id)}.json`);
    writeJsonAtomically(sessionPath, {
      schemaVersion: SESSION_STORE_SCHEMA_VERSION,
      sessionId: session.id,
      scenarioId: session.world.scenarioId,
      savedAt: new Date().toISOString(),
      world: session.world,
    });
    writeJsonAtomically(manifestPath, {
      schemaVersion: SESSION_STORE_SCHEMA_VERSION,
      nextSessionNumber,
      updatedAt: new Date().toISOString(),
    });
  }

  return { enabled: true, load, save };
}

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

export function createBattleEngineServer({ profile = CHANGPING_PROFILE, storageDir = null } = {}) {
  const store = createSessionStore(storageDir);
  const restored = store.load();
  const sessions = restored.sessions;
  let nextSessionNumber = restored.nextSessionNumber;
  const options = sessionOptions(profile);

  function createSession() {
    const id = `changping-${String(nextSessionNumber).padStart(4, '0')}`;
    nextSessionNumber += 1;
    const session = { id, world: profile.createWorld() };
    sessions.set(id, session);
    store.save(session, nextSessionNumber);
    return session;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          schemaVersion: 1,
          engine: 'headless-battlefield-core',
          persistence: store.enabled ? 'filesystem' : 'memory',
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/sessions') {
        const body = await readJsonBody(request);
        const resumeSessionId = typeof body.resumeSessionId === 'string' ? body.resumeSessionId : '';
        const shouldCreateNew = body.newSession === true;
        const session = !shouldCreateNew && resumeSessionId !== '' ? sessions.get(resumeSessionId) : null;
        const resumed = Boolean(session);
        const activeSession = session ?? createSession();
        sendJson(response, resumed ? 200 : 201, {
          sessionId: activeSession.id,
          resumed,
          resumeRequested: resumeSessionId !== '',
          ...buildCommanderGatewayResponse(activeSession.world, { side: options.side, eventCursor: 0, sessionOptions: options.sessionOptions }),
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
        store.save(session, nextSessionNumber);
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
  const storageDir = process.env.BATTLE_ENGINE_STORAGE_DIR ?? resolve(process.cwd(), '.data/battle-engine');
  const { server } = createBattleEngineServer({ storageDir });
  server.listen(port, '127.0.0.1', () => {
    console.log(`战场内核网关已启动：http://127.0.0.1:${port}`);
  });
}
