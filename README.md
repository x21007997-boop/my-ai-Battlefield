# 弘光元年：江南残局

AI 历史分支模拟与叙事平台的首个可运行原型。玩家在弘光元年的特定历史片段中阅读奏报、比较幕僚意见、自由下达决策，并观察国库、粮草、民心和有效防务随回合变化。

## 当前可用体验

- 江南、江北态势主界面；
- 两份可切换奏报及信息矛盾提示；
- 三位幕僚的不同处置意见；
- 御前会议与折中裁决；
- 自由决策输入；
- 决策影响预演；
- 确认执行和月度回合推进；
- 指标更新及浏览器本地快照；
- 调粮、调兵、派官三类结构化决策；
- 即时影响、跨回合延迟后效与条件事件；
- 可审计的回合决策档案；
- 淮安粮荒、扬州江防和南京廷争组成的三个月小剧本；
- `江北暂安`、`强兵弱政`、`江北离心`三种阶段结局。
- DeepSeek AI 御前会商与可直接采用的建议诏令；
- 可从任意节点恢复并继续推演的本地历史分支树。
- 绑定分支节点的 AI 回合纪事，以及 Markdown、Word 小说卷宗下载。
- 剧本选择首页，以及“江南残局”“扬州孤城”两套独立可玩内容。

当前是带有确定性规则内核和 DeepSeek 会商能力的前端原型。自动存档和手动快照保存在浏览器本地，尚未包含正式账号或服务端数据库。

## 本地运行

```bash
npm install
npm run dev
```

DeepSeek 的本地密钥放在 `.env.local`，部署时需要在托管环境设置 `DEEPSEEK_API_KEY`，不要把密钥写入前端代码或提交到 Git。具体说明见 `docs/deepseek.md`。

## 自动化检查

```bash
npm test
npm run validate:scenario
npm run build
npm run test:sites
```

## 技术方向

正式版本建议采用：

- React / TypeScript：产品界面；
- MapLibre GL JS：历史地图与区域图层；
- React Flow：因果链、国策树和历史分支；
- PostgreSQL：事件存储、世界快照和小说资料；
- Redis + BullMQ：回合结算、人物反应和叙事生成；
- 自研确定性规则引擎：正式指标和事件结算；
- 结构化 AI 服务：决策解析、人物反应、奏折和小说叙事。

核心原则：规则引擎负责正式状态，AI 负责理解和叙述；相同世界快照、规则版本、决策与随机种子必须产生相同结果。

## 目录重点

```text
src/                         应用界面、样式与模拟规则
scenarios/                   可独立装载和校验的历史剧本包
public/assets/               地图、纸张、木纹和人物画像
docs/design/                 视觉验收文档
docs/design/screenshots/     实现截图与设计对照图
tests/                       自动化测试
scripts/                     构建辅助脚本
worker/                      Sites 部署入口
.openai/                     Sites 托管配置
```

其中：

- `src/App.jsx`：当前可交互主界面；
- `src/simulation.js`：MVP 确定性结算入口；
- `src/scenario.js`：通用剧本加载、条件判断与动态奏报；
- `scenarios/hongguang-1645/`：弘光元年人物、城市、事件、奏报和结局数据；
- `scenarios/yangzhou-1645/`：扬州守城准备期的独立剧本数据；
- `src/scenarioRegistry.js`：多剧本注册与按 ID 加载；
- `scripts/validate-scenario.mjs`：剧本结构、引用、兜底事件和结局可达性校验；
- `src/storage.js`：本地快照和历史分支树；
- `src/docxExport.js`：Word 小说卷宗排版与导出；
- `server/deepseek.js`：DeepSeek 服务端安全代理；
- `docs/deepseek.md`：AI 接入、密钥和部署说明；
- `docs/narrative.md`：回合纪事、分支卷宗和导出说明；
- `src/styles.css`：历史档案视觉系统；
- `tests/simulation.test.mjs`：决策解析、复现性和三回合闭环测试；
- `docs/engine-v1.md`：推演内核 V1 的规则与数据说明；
- `docs/design/design-qa.md`：视觉对照与验收记录。

## 后续里程碑

1. 将本地分支存档迁移到 PostgreSQL；
2. 建立人物认知、派系关系和不完全信息；
3. 扩充结构化决策类型和规则插件；
4. 增加历史偏离度、分支对比和回放；
5. 建立第二个可替换历史剧本；
6. 预留真人或 AI 统一控制角色的多人席位。
