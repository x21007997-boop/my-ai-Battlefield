import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { getBranchPath } from './storage.js';
import { getScenario } from './scenarioRegistry.js';

const COLORS = { ink: '2C261D', cinnabar: '873327', jade: '315946', gold: 'A47C3C', muted: '75644E', paper: 'F4ECD9', line: 'C9B995' };
const CHINESE_FONT = 'Hiragino Sans GB';

function run(text, options = {}) {
  return new TextRun({ text, font: { name: options.font ?? CHINESE_FONT, eastAsia: options.font ?? CHINESE_FONT }, size: options.size ?? 22, color: options.color ?? COLORS.ink, bold: options.bold, italics: options.italics, break: options.break });
}

function paragraph(text, options = {}) {
  return new Paragraph({
    children: [run(text, options)],
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    spacing: { before: options.before ?? 0, after: options.after ?? 160, line: options.line ?? 320 },
    keepNext: options.keepNext,
    keepLines: options.keepLines,
    pageBreakBefore: options.pageBreakBefore,
  });
}

function heading(text, level = 1) {
  return new Paragraph({ text, heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 });
}

function chapterChildren(node, index) {
  const chronicle = node.chronicle;
  const bodyParagraphs = String(chronicle.fullText).split(/\n+/).filter(Boolean);
  return [
    new Paragraph({ children: [new PageBreak()] }),
    paragraph(`第 ${index + 1} 章`, { alignment: AlignmentType.CENTER, size: 20, color: COLORS.gold, bold: true, after: 120, line: 280 }),
    new Paragraph({ children: [run(chronicle.chapterTitle, { size: 36, color: COLORS.cinnabar, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 360 }, keepNext: true }),
    paragraph(chronicle.opening ?? '', { italics: true, color: COLORS.muted, after: 240 }),
    ...bodyParagraphs.map((text, bodyIndex) => paragraph(text, { after: 180, line: 360, keepLines: true, keepNext: bodyIndex === bodyParagraphs.length - 1 })),
    paragraph(`伏笔　${chronicle.foreshadowing}`, { color: COLORS.muted, italics: true, before: 180, after: 160 }),
  ];
}

function outcomeFromWorld(world) {
  return world.history?.flatMap((record) => record.events ?? []).findLast((event) => event.type === 'chapter_outcome');
}

export async function buildBranchDocx({ store, nodeId, world }) {
  const path = getBranchPath(store, nodeId);
  const chapters = path.filter((node) => node.chronicle);
  if (!chapters.length) throw new Error('当前分支还没有可导出的回合纪事。');
  const records = path.flatMap((node) => node.world?.history?.at(-1) ? [{ node, record: node.world.history.at(-1) }] : []);
  const outcome = outcomeFromWorld(world);
  const scenario = getScenario(world.scenarioId);
  const scenarioTitle = scenario.manifest.title;
  const eraLabel = scenario.presentation.eraLabel;
  const [eraTitle, episodeTitle] = scenarioTitle.split('：');
  const generatedDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(new Date());

  const body = [
    paragraph('历史分支推演小说', { alignment: AlignmentType.CENTER, size: 20, color: COLORS.gold, bold: true, before: 1800, after: 300 }),
    new Paragraph({ children: [run(eraTitle, { size: 60, color: COLORS.cinnabar, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    new Paragraph({ children: [run([...(episodeTitle ?? '')].join(' '), { size: 42, color: COLORS.ink, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 360 } }),
    paragraph('一部由决策、规则与人物共同写成的架空历史', { alignment: AlignmentType.CENTER, size: 24, color: COLORS.jade, after: 1400 }),
    paragraph(`当前分支共 ${chapters.length} 章　·　导出于 ${generatedDate}`, { alignment: AlignmentType.CENTER, size: 19, color: COLORS.muted }),
    new Paragraph({ children: [new PageBreak()] }),
    heading('卷首说明'),
    paragraph(`本卷并非预先写定的故事。每一章均源自玩家在《${scenarioTitle}》中的真实决策。剧本背景为：${scenario.manifest.description}所有国库、粮草、民心、军力与地方事件均由确定性规则结算；AI 仅负责将已经发生的结果整理为叙事，不改变任何正式状态。`),
    heading('目录'),
    ...chapters.map((node, index) => new Paragraph({ children: [run(`第 ${index + 1} 章　${node.chronicle.chapterTitle}`), run(`回合 ${node.world.turn + 1}`, { color: COLORS.muted })], tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 100 } })),
    ...chapters.flatMap(chapterChildren),
    new Paragraph({ children: [new PageBreak()] }),
    heading('人物小传'),
    ...Object.entries(world.officials ?? {}).flatMap(([name, official]) => [
      heading(`${name} · ${official.office}`, 2),
      paragraph(`所在：${official.location}。忠诚 ${official.loyalty}，能力 ${official.ability}。在本分支中，其职守与去向以最终世界快照为准。`),
    ]),
    new Paragraph({ children: [new PageBreak()] }),
    heading('决策年表'),
    ...records.map(({ record }) => paragraph(`第 ${record.turnAfter + 1} 回合｜${record.rawDecision}\n结果：${record.events.map((event) => event.title).join('；')}。指标变化：国库 ${record.effects.treasury >= 0 ? '+' : ''}${record.effects.treasury}，粮草 ${record.effects.grain >= 0 ? '+' : ''}${record.effects.grain}，民心 ${record.effects.support >= 0 ? '+' : ''}${record.effects.support}，防务 ${record.effects.defense >= 0 ? '+' : ''}${record.effects.defense}。`, { after: 220 })),
    heading('结局复盘'),
    paragraph(outcome ? `${outcome.title}\n${outcome.detail}` : '本分支尚未抵达三个月阶段结局，后续回合仍在书写。'),
    paragraph(`最终指标：国库 ${world.metrics.treasury} 万两，粮草 ${world.metrics.grain} 万石，民心 ${world.metrics.support}，有效防务 ${world.metrics.defense}。`, { color: COLORS.jade, bold: true }),
    paragraph(`—— ${eraLabel}推演卷宗终 ——`, { alignment: AlignmentType.CENTER, color: COLORS.gold, before: 600 }),
  ];

  const doc = new Document({
    creator: '历史分支推演模拟器',
    title: scenarioTitle,
    description: '当前历史分支的推演小说卷宗',
    styles: {
      default: { document: { run: { font: CHINESE_FONT, size: 22, color: COLORS.ink }, paragraph: { spacing: { after: 160, line: 320 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: CHINESE_FONT, size: 32, bold: true, color: COLORS.cinnabar }, paragraph: { spacing: { before: 360, after: 200 }, keepNext: true, border: { bottom: { color: COLORS.line, style: BorderStyle.SINGLE, size: 4, space: 6 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: CHINESE_FONT, size: 26, bold: true, color: COLORS.jade }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [run(scenarioTitle, { size: 18, color: COLORS.muted })], border: { bottom: { color: COLORS.line, style: BorderStyle.SINGLE, size: 3, space: 5 } } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [run('历史分支卷宗　', { size: 17, color: COLORS.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 17, color: COLORS.muted })], alignment: AlignmentType.RIGHT })] }) },
      children: body,
    }],
  });
  return Packer.toBlob(doc);
}

export async function downloadBranchDocx({ store, nodeId, world }) {
  const chapters = getBranchPath(store, nodeId).filter((node) => node.chronicle);
  const blob = await buildBranchDocx({ store, nodeId, world });
  const scenarioTitle = getScenario(world.scenarioId).manifest.title;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${scenarioTitle.replace(/[\/:*?"<>|：]/g, '-')}-${chapters.length}章.docx`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function buildGeneratedNovelDocx({ novel, world }) {
  const scenario = getScenario(world.scenarioId);
  const scenarioTitle = scenario.manifest.title;
  const body = [
    paragraph('历史推演长篇小说', { alignment: AlignmentType.CENTER, size: 20, color: COLORS.gold, before: 1700, after: 260 }),
    paragraph(novel.title, { alignment: AlignmentType.CENTER, size: 54, color: COLORS.cinnabar, bold: true, after: 100 }),
    paragraph(novel.subtitle ?? scenarioTitle, { alignment: AlignmentType.CENTER, size: 25, color: COLORS.jade, after: 1400 }),
    new Paragraph({ children: [new PageBreak()] }),
    heading('序章'),
    ...String(novel.prologue).split(/\n+/).filter(Boolean).map((text) => paragraph(text, { line: 360 })),
    ...novel.chapters.flatMap((chapter, index) => [
      new Paragraph({ children: [new PageBreak()] }),
      paragraph(`第 ${index + 1} 章`, { alignment: AlignmentType.CENTER, color: COLORS.gold, bold: true }),
      paragraph(chapter.title, { alignment: AlignmentType.CENTER, size: 36, color: COLORS.cinnabar, bold: true, after: 340 }),
      ...String(chapter.text).split(/\n+/).filter(Boolean).map((text) => paragraph(text, { line: 360 })),
    ]),
    new Paragraph({ children: [new PageBreak()] }),
    heading('人物结局'),
    ...novel.characterEndings.flatMap((person) => [heading(person.name, 2), paragraph(person.ending)]),
    heading('尾声'),
    ...String(novel.epilogue).split(/\n+/).filter(Boolean).map((text) => paragraph(text, { line: 360 })),
    paragraph(`—— 《${scenarioTitle}》全卷终 ——`, { alignment: AlignmentType.CENTER, color: COLORS.gold, before: 600 }),
  ];
  const doc = new Document({ creator: '历史分支推演模拟器', title: novel.title, description: `由《${scenarioTitle}》完整历史分支生成的架空历史小说`, sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, headers: { default: new Header({ children: [paragraph(`${novel.title} · ${scenarioTitle}`, { size: 17, color: COLORS.muted })] }) }, footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: [PageNumber.CURRENT], size: 17, color: COLORS.muted })], alignment: AlignmentType.RIGHT })] }) }, children: body }] });
  return Packer.toBlob(doc);
}

export async function downloadGeneratedNovelDocx({ novel, world }) {
  const blob = await buildGeneratedNovelDocx({ novel, world });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${novel.title.replace(/[\\/:*?"<>|]/g, '-')}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
