import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildBranchDocx } from '../src/docxExport.js';
import { createInitialWorld, resolveTurn } from '../src/simulation.js';

const decisions = ['调拨二十万石粮草赈济淮安', '调动五万兵力增援扬州', '派遣史可法前往淮安查办'];
const titles = ['淮安粥火', '江上换防', '廷议未央'];
const paragraphs = [
  '秋水渐寒，清江浦外的芦苇被晨雾压得低伏。第一艘粮船靠上石岸时，码头上没有欢呼，只有饥民压低的喘息。周廷辅立在仓门前，亲手验过封条，又命书吏将每一袋耗损逐笔记下。他知道这二十万石粮食不只为填饱肚腹，也是在替朝廷挽回一道将断未断的信义。',
  '南京的诏令沿驿道北上，扬州诸营随即换哨。史可法披衣登城，看着江面上稀疏的灯船，听部将报出新到兵数与兵部文册之间的差额。他没有当众发作，只命人封存名册。军心可以用饷银稳住一时，却不能靠一纸虚数守住长江。',
  '入夜后，值房仍亮着灯。户部、兵部与督师幕府的文书堆在案上，数字彼此抵牾。朝臣争论的是兵权，地方等待的却是下一船粮与下一笔饷。皇帝最后落笔派官查办，朱砂在纸上未干，新的疑问已经随着夜雨落进宫城。',
];

let world = createInitialWorld();
const nodes = [{ id: 'root', parentId: null, label: '弘光元年·八月初始局势', world }];
let parentId = 'root';
for (let index = 0; index < decisions.length; index += 1) {
  const result = resolveTurn(world, decisions[index]);
  world = result.world;
  const id = `fixture-${index + 1}`;
  nodes.push({
    id,
    parentId,
    label: `第${world.turn + 1}回合`,
    decision: decisions[index],
    world,
    chronicle: {
      chapterTitle: titles[index],
      opening: paragraphs[index].slice(0, 45),
      fullText: Array.from({ length: 5 }, (_, part) => `${paragraphs[index]}第${part + 1}次传来的消息，使局势又多了一层含义。`).join('\n\n'),
      foreshadowing: index === 2 ? '江北驿道传来未署名的急报。' : '账册与前线人数仍有无法解释的缺口。',
    },
  });
  parentId = id;
}

const output = resolve(process.argv[2] ?? 'sample-novel.docx');
const blob = await buildBranchDocx({ store: { nodes }, nodeId: parentId, world });
await writeFile(output, Buffer.from(await blob.arrayBuffer()));
console.log(output);
