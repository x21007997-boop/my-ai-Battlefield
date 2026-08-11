import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildBranchDocx, buildGeneratedNovelDocx } from '../src/docxExport.js';

async function documentXml(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('word/document.xml').async('string');
}

test('builds a Word novel from the current branch', async () => {
  const record = { turnAfter: 4, rawDecision: '调拨二十万石粮草赈济淮安', effects: { treasury: -11, grain: -20, support: 4, defense: 0 }, events: [{ title: '淮安粥厂重新开灶' }] };
  const world = { turn: 4, metrics: { treasury: 809, grain: 440, support: 56, defense: 61 }, officials: { 史可法: { office: '江北督师', location: '扬州', loyalty: 86, ability: 88 } }, history: [record] };
  const store = { nodes: [{ id: 'root', parentId: null, world: { turn: 3, history: [] } }, { id: 'chapter-1', parentId: 'root', world, chronicle: { chapterTitle: '淮安粥火', opening: '秋水渐寒。', fullText: '粮船沿运河北上。'.repeat(100), foreshadowing: '账册仍有缺口。' } }] };
  const blob = await buildBranchDocx({ store, nodeId: 'chapter-1', world });
  assert.match(blob.type, /wordprocessingml/);
  assert.ok(blob.size > 5000);
});

test('builds a complete generated novel DOCX', async () => {
  const novel = { title: '江北残卷', subtitle: '弘光元年纪事', prologue: '序章文字。'.repeat(100), chapters: [{ title: '粮船入淮', text: '正文。'.repeat(300) }], characterEndings: [{ name: '史可法', ending: '仍守江北。' }], epilogue: '尾声。'.repeat(120) };
  const world = { scenarioId: 'hongguang-jiangnan-1645' };
  const blob = await buildGeneratedNovelDocx({ novel, world });
  assert.match(blob.type, /wordprocessingml/);
  assert.ok(blob.size > 5000);
});

test('uses the selected scenario throughout the exported Word manuscript', async () => {
  const novel = { title: '扬州残照', subtitle: '孤城三月', prologue: '序章。'.repeat(100), chapters: [{ title: '城门', text: '正文。'.repeat(300) }], characterEndings: [{ name: '刘肇基', ending: '整军守城。' }], epilogue: '尾声。'.repeat(120) };
  const blob = await buildGeneratedNovelDocx({ novel, world: { scenarioId: 'hongguang-yangzhou-1645' } });
  const xml = await documentXml(blob);
  assert.match(xml, /弘光元年：扬州孤城/);
  assert.match(xml, /刘肇基/);
  assert.doesNotMatch(xml, /弘光元年：江南残局/);
});
