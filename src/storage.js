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

function campaignIdFor(scenarioId) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `campaign-${scenarioId}-${suffix}`;
}

export function initializeBranchTree(world) {
  const store = readStore();
  if (store.nodes.some((node) => node.world?.scenarioId === world.scenarioId)) return store;
  const root = { id: `root-${world.scenarioId}`, parentId: null, label: '剧本初始局势', createdAt: new Date().toISOString(), world };
  store.nodes.push(root);
  return writeStore(store);
}

function descendantsOf(store, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    store.nodes.forEach((node) => { if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; } });
  }
  return ids;
}

export function listCampaigns(store, scenarioId) {
  return store.nodes
    .filter((node) => !node.parentId && node.world?.scenarioId === scenarioId)
    .map((root) => {
      const ids = descendantsOf(store, root.id);
      const nodes = store.nodes.filter((node) => ids.has(node.id));
      const latest = nodes.toSorted((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1) ?? root;
      return { id: root.id, name: root.campaignName ?? root.label ?? '未命名推演', createdAt: root.createdAt, updatedAt: latest.createdAt, latest, nodeCount: nodes.length };
    })
    .toSorted((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createCampaign(world, name = '新推演') {
  const store = readStore();
  const id = campaignIdFor(world.scenarioId);
  store.nodes.push({ id, parentId: null, label: '剧本初始局势', campaignName: name, createdAt: new Date().toISOString(), world });
  writeStore(store);
  return { store, id };
}

export function renameCampaign(campaignId, name) {
  const store = readStore();
  const root = store.nodes.find((node) => node.id === campaignId && !node.parentId);
  if (!root) throw new Error('未找到这份推演存档。');
  root.campaignName = name.trim() || '未命名推演';
  return writeStore(store);
}

export function duplicateCampaign(campaignId) {
  const store = readStore();
  const root = store.nodes.find((node) => node.id === campaignId && !node.parentId);
  if (!root) throw new Error('未找到这份推演存档。');
  const source = listCampaigns(store, root.world.scenarioId).find((campaign) => campaign.id === campaignId)?.latest ?? root;
  const id = campaignIdFor(root.world.scenarioId);
  store.nodes.push({ id, parentId: null, label: '复制的历史分支', campaignName: `${root.campaignName ?? '推演'} · 副本`, createdAt: new Date().toISOString(), world: JSON.parse(JSON.stringify(source.world)) });
  writeStore(store);
  return { store, id };
}

export function deleteCampaign(campaignId) {
  const store = readStore();
  const ids = descendantsOf(store, campaignId);
  store.nodes = store.nodes.filter((node) => !ids.has(node.id));
  return writeStore(store);
}

export function exportCampaignArchive(campaignId) {
  const store = readStore();
  const root = store.nodes.find((node) => node.id === campaignId && !node.parentId);
  if (!root) throw new Error('未找到这份推演存档。');
  const ids = descendantsOf(store, campaignId);
  const nodes = store.nodes.filter((node) => ids.has(node.id));
  return JSON.stringify({
    format: 'hongguang-campaign-v1',
    exportedAt: new Date().toISOString(),
    scenarioId: root.world.scenarioId,
    campaignName: root.campaignName ?? root.label ?? '未命名推演',
    nodes,
  }, null, 2);
}

export function importCampaignArchive(rawArchive, expectedScenarioId) {
  let archive;
  try { archive = typeof rawArchive === 'string' ? JSON.parse(rawArchive) : rawArchive; } catch { throw new Error('存档文件不是有效的 JSON。'); }
  if (archive?.format !== 'hongguang-campaign-v1' || !Array.isArray(archive.nodes) || !archive.nodes.length) throw new Error('无法识别这份推演存档。');
  try { getScenario(archive.scenarioId); } catch { throw new Error('存档引用了当前版本不支持的历史剧本。'); }
  if (expectedScenarioId && archive.scenarioId !== expectedScenarioId) throw new Error('这份存档属于另一个历史剧本。');
  const roots = archive.nodes.filter((node) => !node.parentId);
  if (roots.length !== 1 || archive.nodes.some((node) => node.world?.scenarioId !== archive.scenarioId || !Array.isArray(node.world?.history))) throw new Error('存档结构不完整或剧本信息不一致。');
  const sourceIds = new Set(archive.nodes.map((node) => node.id));
  if (sourceIds.size !== archive.nodes.length || archive.nodes.some((node) => node.parentId && !sourceIds.has(node.parentId))) throw new Error('存档中的历史分支关系已经损坏。');
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const idMap = new Map(archive.nodes.map((node, index) => [node.id, `import-${suffix}-${index}`]));
  const importedAt = new Date().toISOString();
  const nodes = archive.nodes.map((node) => ({ ...JSON.parse(JSON.stringify(node)), id: idMap.get(node.id), parentId: node.parentId ? idMap.get(node.parentId) : null }));
  const root = nodes.find((node) => !node.parentId);
  root.campaignName = `${archive.campaignName || '导入推演'} · 导入`;
  root.createdAt = importedAt;
  const store = readStore();
  store.nodes.push(...nodes);
  writeStore(store);
  return { store, id: root.id, scenarioId: archive.scenarioId };
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
