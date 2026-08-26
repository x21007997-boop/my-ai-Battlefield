import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.BATTLE_ENGINE_PORT ?? 4317);
const engineUrl = `http://127.0.0.1:${port}`;

function findGodot() {
  const configured = process.env.GODOT_BIN;
  if (configured) return configured;
  try {
    return execFileSync('which', ['godot'], { encoding: 'utf8' }).trim();
  } catch {
    return ['/Applications/Godot.app/Contents/MacOS/Godot', '/Applications/Godot4.app/Contents/MacOS/Godot']
      .find((candidate) => existsSync(candidate)) ?? '';
  }
}

async function engineIsHealthy() {
  try {
    const response = await fetch(`${engineUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForEngine() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await engineIsHealthy()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  return false;
}

const godot = findGodot();
if (!godot) {
  console.error('未找到 Godot。请安装 Godot 4，或通过 GODOT_BIN 指定 Godot 可执行文件。');
  process.exit(1);
}

const reuseExistingEngine = await engineIsHealthy();
const engine = reuseExistingEngine ? null : spawn(process.execPath, ['scripts/battle-engine-server.mjs'], {
  cwd: root,
  env: { ...process.env, BATTLE_ENGINE_PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const stopEngine = () => {
  if (engine && !engine.killed) engine.kill('SIGTERM');
};
process.on('SIGINT', stopEngine);
process.on('SIGTERM', stopEngine);
process.on('exit', stopEngine);

if (!await waitForEngine()) {
  stopEngine();
  console.error('本地战场内核启动失败，无法进入试玩。');
  process.exit(1);
}

const godotArgs = ['--path', resolve(root, 'godot')];
if (process.env.PLAYTEST_HEADLESS === '1') {
  godotArgs.unshift('--headless', '--quit-after', process.env.PLAYTEST_QUIT_AFTER ?? '8');
}
const client = spawn(godot, godotArgs, {
  cwd: root,
  env: { ...process.env, BATTLE_ENGINE_URL: engineUrl },
  stdio: 'inherit',
});

client.on('exit', (code, signal) => {
  stopEngine();
  process.exit(code ?? (signal ? 1 : 0));
});
