# 历史战争认知沙盘

一款基于历史背景的实时战争推演游戏。玩家在沙盘上指挥军队，接收延迟且可能失真的情报，通过连续决策改变战役走向。弘光元年政治推演作为独立的历史决策模式保留，长平之战是当前第一张正式可玩的实时战役关卡。

## 原型与正式项目边界

- `src/prototype/political/` 和弘光/扬州剧本属于之前的历史政治决策原型，继续独立维护，不作为实时战场规则或正式客户端基础；
- `src/battlefield/`、`scenarios/changping-260/` 和 `godot/` 属于正式的历史战争实时推演项目；
- `src/prototype/battlefield/BattlefieldPrototype.jsx` 是正式项目迁移期间的浏览器原型验证入口，Godot 才是正式游戏客户端；
- 原型的完成、测试通过或界面可用，不等于正式项目已经完成。正式项目必须以 Godot 中可玩的战役闭环为验收标准。

## 当前可用体验

- 长平战役正式关卡：沙盘指挥、连续时间、延迟命令、侦查、欺骗和敌方认知行动；
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

当前版本包含确定性战场规则内核、Godot 正式游戏客户端和浏览器过渡验证入口。战场内核会把本地战局会话保存到 `.data/battle-engine/`，Godot 会记住最近一局并在重新启动时恢复；正式账号、云存档和联机服务尚未接入。

## 本地运行

```bash
npm install
npm run dev
```

如需单独启动正式战场内核，可运行 `npm start`；试玩入口 `npm run playtest` 会自动启动它。可通过 `BATTLE_ENGINE_STORAGE_DIR` 指定战局存档目录。

DeepSeek 的本地密钥放在 `.env.local`，部署时需要在托管环境设置 `DEEPSEEK_API_KEY`，不要把密钥写入前端代码或提交到 Git。具体说明见 `docs/deepseek.md`。

## 自动化检查

```bash
npm test
npm run validate:scenario
npm run build
npm run test:sites
```

## 技术方向

正式游戏采用：

- Godot：正式游戏运行时、沙盘表现、输入和回放界面；
- JavaScript 无头内核：确定性世界状态、实时推进、战斗、后勤和胜负；
- 版本化战役包：历史来源、地理、单位、侦查、欺骗和结局数据；
- React / Vite：迁移期的规则验证和战役数据编辑入口；
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

- `src/prototype/political/App.jsx`：既有政治决策原型主界面；
- `godot/`：正式游戏客户端工程；
- `src/prototype/battlefield/BattlefieldPrototype.jsx`：迁移期浏览器战役验证入口，不作为正式客户端；
- `src/prototype/political/simulation.js`：既有政治原型的确定性结算入口；
- `src/prototype/political/scenario.js`：既有政治原型的剧本加载、条件判断与动态奏报；
- `scenarios/hongguang-1645/`：弘光元年人物、城市、事件、奏报和结局数据；
- `scenarios/yangzhou-1645/`：扬州守城准备期的独立剧本数据；
- `src/prototype/political/scenarioRegistry.js`：既有政治原型的多剧本注册与按 ID 加载；
- `scripts/validate-scenario.mjs`：剧本结构、引用、兜底事件和结局可达性校验；
- `src/prototype/political/storage.js`：既有政治原型的本地快照和历史分支树；
- `src/prototype/political/docxExport.js`：既有政治原型的 Word 小说卷宗排版与导出；
- `server/deepseek.js`：DeepSeek 服务端安全代理；
- `docs/deepseek.md`：AI 接入、密钥和部署说明；
- `docs/narrative.md`：回合纪事、分支卷宗和导出说明；
- `src/styles.css`：历史档案视觉系统；
- `tests/simulation.test.mjs`：决策解析、复现性和三回合闭环测试；
- `tests/e2e/core-flow.spec.js`：选局、序章、诏令识别、影响分析、体验设置与快捷键的真实浏览器回归；
- `npm run test:ci`：一次执行剧本校验、规则测试、浏览器测试、生产构建和 Sites 兼容测试；
- `.github/workflows/quality.yml`：每次推送和 Pull Request 自动运行质量门禁，失败时保留 Playwright 诊断文件；
- `docs/engine-v1.md`：推演内核 V1 的规则与数据说明；
- `docs/design/design-qa.md`：视觉对照与验收记录。

## 后续里程碑

1. 将本地分支存档迁移到 PostgreSQL；
2. 建立人物认知、派系关系和不完全信息；
3. 扩充结构化决策类型和规则插件；
4. 增加历史偏离度、分支对比和回放；
5. 建立第二个可替换历史剧本；
6. 预留真人或 AI 统一控制角色的多人席位。
