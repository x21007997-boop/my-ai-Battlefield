import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDeepSeek, handleDeepSeekChronicle, handleDeepSeekNovel } from '../server/deepseek.js';

test('DeepSeek proxy rejects requests when the server key is missing', async () => {
  const response = await handleDeepSeek(new Request('http://local/api/ai/council', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 503);
});

test('DeepSeek proxy validates and parses structured council output', async () => {
  const fetchImpl = async (_url, options) => {
    assert.match(options.headers.authorization, /^Bearer /);
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.match(body.messages[0].content, /扬州孤城/);
    assert.match(body.messages[1].content, /刘肇基/);
    return Response.json({ model: 'deepseek-v4-flash', choices: [{ message: { content: JSON.stringify({ summary: '先稳粮道。', advisers: [], recommendedDecision: '调拨十万石粮草赈济淮安', uncertainty: '途中耗损不明' }) } }], usage: { total_tokens: 100 } });
  };
  const request = new Request('http://local/api/ai/council', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world: { turn: 3, metrics: {}, cities: {}, flags: [], history: [] }, question: '如何处置？', scenario: { title: '弘光元年：扬州孤城', actionDefaults: { grainTarget: '扬州', armyTarget: '扬州', official: '史可法' }, advisers: [{ name: '刘肇基', stance: '整军迎敌' }] } }) });
  const response = await handleDeepSeek(request, { apiKey: 'test-key', fetchImpl });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.recommendedDecision, '调拨十万石粮草赈济淮安');
});

test('chronicle proxy accepts a structured chapter', async () => {
  const fetchImpl = async () => Response.json({ model: 'deepseek-v4-flash', choices: [{ message: { content: JSON.stringify({ chapterTitle: '粮船入淮', opening: '秋水渐寒。', courtScene: '廷议调粮。', executionScene: '粮船北上。', consequence: '米价稍平。', foreshadowing: '账册仍有缺口。', fullText: '秋水渐寒，粮船沿运河北上。'.repeat(60) }) } }] });
  const request = new Request('http://local/api/ai/chronicle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world: { turn: 4, metrics: {}, cities: {}, flags: [], history: [] }, record: { rawDecision: '调拨二十万石粮草赈济淮安', events: [] } }) });
  const response = await handleDeepSeekChronicle(request, { apiKey: 'test-key', fetchImpl });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.chapterTitle, '粮船入淮');
});

test('novel proxy accepts a complete structured manuscript', async () => {
  const fetchImpl = async () => Response.json({ model: 'deepseek-v4-flash', choices: [{ message: { content: JSON.stringify({ title: '江北残卷', subtitle: '弘光元年纪事', prologue: '序'.repeat(400), chapters: [{ title: '第一章', text: '正文'.repeat(500) }], characterEndings: [{ name: '史可法', ending: '仍守江北。' }], epilogue: '尾声'.repeat(350) }) } }] });
  const request = new Request('http://local/api/ai/novel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world: { turn: 6, metrics: {}, cities: {}, flags: [], history: [] }, records: [{ rawDecision: '调粮' }], chronicles: [], outcome: { outcome: '江北暂安' } }) });
  const response = await handleDeepSeekNovel(request, { apiKey: 'test-key', fetchImpl });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.title, '江北残卷');
  assert.equal(result.chapters.length, 1);
});
