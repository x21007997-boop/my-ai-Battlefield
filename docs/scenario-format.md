# 历史剧本包格式 V1

每个历史片段使用一个独立目录。通用规则引擎不应包含人物姓名、城市初值、奏报正文或结局文案。

```text
scenarios/<scenario-id>/
├── manifest.json
├── initial-world.json
├── cities.json
├── characters.json
├── events.json
├── reports.json
├── endings.json
└── narrative-guide.md
```

## 文件职责

- `manifest.json`：剧本身份、版本、起止回合和规则兼容版本；
- `initial-world.json`：随机种子、初始指标、上期变化和世界标记；
- `cities.json`：城市控制权、粮食、驻军和动荡；
- `characters.json`：人物官职、位置、忠诚和能力；
- `events.json`：阶段事件、触发条件、影响、标记和动态奏报；
- `reports.json`：初始奏报以及通用局势奏报；
- `endings.json`：按优先级判断的阶段结局；
- `narrative-guide.md`：AI 写作的剧本语气与事实边界。

## 声明式条件

事件使用条件数组，不在剧本文件中编写 JavaScript：

```json
{
  "conditions": [
    { "path": "action.type", "op": "eq", "value": "transport_grain" },
    { "path": "world.metrics.support", "op": "gte", "value": 55 }
  ]
}
```

支持 `eq`、`neq`、`gte`、`lte` 和 `includes`。默认要求全部条件成立，设置 `"match": "any"` 后只需满足任一条件。相同回合按 `priority` 从小到大匹配，第一个成立的事件生效。空条件定义作为兜底事件，应放在最低优先级。

## 发布前校验

```bash
npm run validate:scenario
```

校验内容包括：

- 必需文件和 JSON 语法；
- 清单必填字段；
- 城市、人物和事件 ID 唯一性；
- 人物位置及奏报地区引用；
- 指标名称、数值类型和条件操作符；
- 每个事件回合是否存在兜底路线；
- 弘光剧本 27 条基础决策组合下的三个结局是否全部可达。

既有政治原型的剧本注册表位于 `src/prototype/political/scenarioRegistry.js`。首页从注册表读取标题、简介、城池、事件、结局和存档进度；进入剧本后，规则引擎依据世界状态中的 `scenarioId` 自动选择对应数据包。当前已注册“江南残局”和“扬州孤城”两个剧本。正式战役使用独立的 `scenarios/` 战役包和 `src/battlefield/` 内核，不复用这套月度政治剧本格式。

新增剧本时需要：

1. 按上述格式创建完整目录；
2. 在 `scenarioRegistry.js` 注册数据文件；
3. 在 `manifest.json` 配置 `turnLabels`、`actionDefaults` 和首页 `cover` 信息；
4. 运行 `npm run validate:scenario`；
5. 增加至少一条从初始世界运行到结局的自动化测试。
