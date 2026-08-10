import { getScenario } from './scenarioRegistry.js';

const BRANCH_KEY = 'hongguang-branch-tree-v1';

function readStore() {
  try {
    return JSON.parse(window.localStorage.getItem(BRANCH_KEY)) ?? { nodes: [] };
  } catch {
    return { nodes: [] };
  }
}

function writeStore(store) {
  window.localStorage.setItem(BRANCH_KEY, JSON.stringify(store));
  return store;
}

export function initializeBranchTree(world) {
  const store = readStore();
  if (store.nodes.some((node) => node.world?.scenarioId === world.scenarioId)) return store;
  const root = { id: `root-${world.scenarioId}`, parentId: null, label: '剧本初始局势', createdAt: new Date().toISOString(), world };
  store.nodes.push(root);
  return writeStore(store);
}

export function appendBranchNode(parentId, world, record) {
  const store = readStore();
  const id = `${record.id}-${Date.now().toString(36)}`;
  store.nodes.push({ id, parentId, label: `第${record.turnAfter + 1}回合 · ${record.events.at(-1).title}`, decision: record.rawDecision, createdAt: new Date().toISOString(), world });
  writeStore(store);
  return { store, id };
}

export function saveNamedSnapshot(parentId, world) {
  const store = readStore();
  const id = `snapshot-${Date.now().toString(36)}`;
  store.nodes.push({ id, parentId, label: `手动快照 · 第${world.turn + 1}回合`, createdAt: new Date().toISOString(), world, snapshot: true });
  writeStore(store);
  return { store, id };
}

export function attachChronicle(nodeId, chronicle) {
  const store = readStore();
  const node = store.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error('未找到对应的历史节点。');
  node.chronicle = { ...chronicle, generatedAt: new Date().toISOString() };
  writeStore(store);
  return store;
}

export function updateBranchNodeWorld(nodeId, world) {
  const store = readStore();
  const node = store.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error('未找到对应的历史节点。');
  node.world = world;
  writeStore(store);
  return store;
}

export function getBranchPath(store, nodeId) {
  const path = [];
  let node = store.nodes.find((item) => item.id === nodeId);
  while (node) {
    path.unshift(node);
    node = node.parentId ? store.nodes.find((item) => item.id === node.parentId) : null;
  }
  return path;
}

export function buildManuscript(store, nodeId) {
  const path = getBranchPath(store, nodeId);
  const chapters = path.filter((node) => node.chronicle);
  const title = getScenario(path.at(-1)?.world?.scenarioId).manifest.title;
  const body = chapters.map((node, index) => `## 第${index + 1}章　${node.chronicle.chapterTitle}\n\n${node.chronicle.fullText}`).join('\n\n---\n\n');
  return `# ${title}\n\n> 本卷由历史推演分支自动汇编，共 ${chapters.length} 章。\n\n${body || '尚未生成回合纪事。'}\n`;
}
