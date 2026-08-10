import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBranchNode, attachChronicle, buildManuscript, createCampaign, deleteCampaign, duplicateCampaign, getBranchPath, initializeBranchTree, listCampaigns, renameCampaign } from '../src/storage.js';

function mockStorage() {
  const values = new Map();
  global.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
}

test('chronicles remain attached to their own branch path', () => {
  mockStorage();
  const world = { turn: 3, history: [] };
  initializeBranchTree(world);
  const record = { id: 'a', turnAfter: 4, rawDecision: '调粮', events: [{ title: '粮船入淮' }] };
  const first = appendBranchNode('root', { turn: 4, history: [record] }, record);
  attachChronicle(first.id, { chapterTitle: '粮船入淮', fullText: '第一章正文', foreshadowing: '欠饷' });
  const sibling = appendBranchNode('root', { turn: 4, history: [{ ...record, id: 'b' }] }, { ...record, id: 'b', rawDecision: '调兵' });
  assert.equal(getBranchPath(sibling.store, sibling.id).some((node) => node.chronicle), false);
  const manuscript = buildManuscript(attachChronicle(first.id, { chapterTitle: '粮船入淮', fullText: '第一章正文', foreshadowing: '欠饷' }), first.id);
  assert.match(manuscript, /第一章正文/);
});

test('campaign saves can be created, renamed, duplicated, and deleted', () => {
  mockStorage();
  const world = { scenarioId: 'test-scenario', turn: 0, history: [] };
  const created = createCampaign(world, '第一次推演');
  assert.equal(listCampaigns(created.store, 'test-scenario')[0].name, '第一次推演');
  const renamed = renameCampaign(created.id, '江北线');
  assert.equal(listCampaigns(renamed, 'test-scenario')[0].name, '江北线');
  const duplicated = duplicateCampaign(created.id);
  assert.equal(listCampaigns(duplicated.store, 'test-scenario').length, 2);
  const deleted = deleteCampaign(created.id);
  assert.equal(listCampaigns(deleted, 'test-scenario').length, 1);
});
