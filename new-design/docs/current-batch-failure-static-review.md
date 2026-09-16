# 当前批历史失败与必要修复静态收口

日期：2026-09-17。范围仅为原授权 P1／P2／P3 及其必要修复，不启动下一批计划。本切片只阅读源码、依赖声明和历史失败记录，未执行测试、构建、类型检查、依赖安装、迁移、HTTP、模型、启动或浏览器验收。

后续已在全部原编码与静态收口完成后进入统一验证；实际安装、构建、380 项通过、独立 PG 迁移及集中修复结果另见[当前原批统一验证](current-batch-unified-validation.md)。本页保留当时静态切片的真实未执行状态，不覆盖历史失败。

## 历史失败证据（修复后未复测）

用户再次锁定策略前，原统一检查实际执行过：

- 首次 `npm run build`：`src/server/database/productionDirector/index.ts:56` 多余右括号，失败。
- 修正括号后的 `npm run build`：服务端书籍读取导出、审核命令缩窄及故事时间来源类型不匹配，失败，未进入客户端构建。
- `npm run typecheck:client`：缺少 Tiptap 模块；回调上下文类型缺失；嵌入编辑器错误缩窄完整原请求；表单补充字段缺少公共默认值属性，失败。

这些是历史失败，不是本次运行结果，也不证明修复后通过。当前失败记录不得删除或改写成成功。

## 逐项修复与静态核对

| 历史问题 | 实际修复／源码证据 | 静态边界与当前结论 |
| --- | --- | --- |
| 导演结束过期领取的语法错误 | `src/server/database/productionDirector/index.ts`：原 `client.query` 参数数组内 `JSON.stringify(directorRecovery(...))` 关闭后直接关闭数组和 query，不再多一个括号 | 不改运行状态、原请求或事务结果含义；已修复，未复测 |
| 全书编排读取错误导出 | `src/server/database/bookComposition/index.ts`：`getBook` 从原 `../templateStore` 导入 | 不绕过新设计 facade、不借旧系统读取；已修复，未复测 |
| 审核命令 action 未缩窄 | `src/server/database/bookComposition/timeline.ts`：在实际访问处分支用 `"action" in input.command` | create/edit/occurrence 仍按原值预览；不强转成 review，不改审核决定；已修复，未复测 |
| 历史 migration 来源被新输入承接 | `src/common/bookComposition/timeline.ts`：作者时间输入明确排除 migration；`src/server/database/storyTimeline/store.ts`：确认前检查原 currentVersion、解构来源并拒绝 migration，再走原 `validateEvidence` | 正式历史读取仍保留 migration；不允许新提案或确认借历史迁移来源冒充可追溯用户证据，不盲 as 扩大输入；已修复，未复测 |
| 表单补充字段 defaultValue 合同缺失 | `src/common/contracts.ts`：四个历史核心属性必需，其余正式 FieldDefinition 属性可选；原 serializer 保留默认值，严格写入仍走 `src/server/database/structureWrites/formSchema.ts` 的完整正式定义 | 不删默认值／字典／选项，不凭补类型自动把旧缺 order 的记录升级；0／false 不被当空值。页面新增位置来自原关系完整 propertiesSchema；已修复，未复测 |
| 嵌入恢复解析只校验草稿并错误缩窄 | `src/client/modelSettings/embeddingEditing.ts`：unknown→record，专门 `savedInput` 校验完整原 key、配置 ID／修订成对条件及连接字段；独立 `savedBase` 校验 | 返回原完整 input，不强转、不删 key、不换版本；坏／缺字段返回 null，实际面板 raw 非空时保留原存储并锁提交；本地 notWritten／checked 均重置。已编码及静态交叉 review，未复测 |
| Tiptap 模块不可解析及回调隐式 any | `new-design/package.json` 与 `package-lock.json` 都锁定 `@tiptap/core`、`pm`、`react`、`starter-kit` 为 3.31.3；原 `bodyEditor` 导入 React 菜单和 PM model，回调依赖真实 API 上下文类型 | 声明／锁定编码已齐全；尚未安装，不能证明导入、回调、StarterKit 参数或运行兼容性。统一阶段按本包锁文件安装后检查；不加假模块声明／any 或借旧包依赖掩盖问题 |

本切片开始时已知尚未编码修复为 **1 项**：嵌入完整原请求解析器；其余必要类型修复已由原分工交回。解析器与补充负向用例已落盘并完成静态交叉 review，不因“文件存在”自动宣布动态验收。

静态交叉 review 新发现 **2 项**必要恢复修复，不能据前述盘点宣布已收口：

- 向量连接 raw endpoint／model 与服务端 trim 后版本不一致：新准备按原规则 trim 并冻结，原填写保留；历史原 input 不重写，只读匹配按同规则比较完整 hash、版本和 publication 修订。原配置初始 revision=1／首次提交为2 已按023 SQL核对。已编码及最终静态交叉 review，未复测。
- 表单 localFields 缺可选 defaults／含前后空白时，与严格保存后的正式结构不一致：`common/formLocalFieldNormalization.ts` 只补已定义 defaults／trim，保存时原raw另存，旧pending只读规范化两个副本核对完整结构。`FormDesignerPage` 保存传原raw，`structureWrites/useRecovery` 校验原raw与冻结稿同 ID／修订／完整规范化内容后展示原raw；发布保持原输入／原修订。未补必需 order／rule／mode／depthMode，不改变原key，不strip扩展字段。已编码及静态交叉 review，未复测。

最终交叉 review 又发现 **1 项**长度边界：服务端按 trim 后长度校验，而恢复草稿曾按 raw 长度拒绝，合法临界长度加空白可能锁住有效原单。守卫已改成 trim 后1000／300；retain 的30,000字符容量限制在 setItem 前同步锁定，不覆盖旧凭证、不发新请求；原raw仍保留。临界值／超1／容量顺序用例已写，静态最终复核未见剩余必要修复。

## 当前收口结论

本次已知必要编码修复剩余 **0**。原各分工 DONE，嵌入恢复／规范化／完整 hash／长度边界、表单默认规则／原raw／旧回执及发布修订已完成主任务静态核对和分工交叉 review；未见尚待编码的本切片合同／类型／接线修复。全批原授权源码静态收口条件达到，可安排同一批统一验证，**本切片未执行统一验证**。

仍待检查或存在真实环境／能力风险：Tiptap未安装与安装后上下文类型／API兼容性、迁移未应用、隔离PG测试目标未核实、真实模型配置／回复／用量未验收、界面交用户体验，以及既有坏凭证／失效来源／未接图像生成执行器。上述不是“修复后已通过”，也不能据此扩展下一批功能或无授权接外部服务。

## 用例只写、不运行

`tests/managed-embedding-model.unit.test.cjs` 补原请求完整保留、配置 ID／修订不成对、非法原键／修订、额外字段、坏 base、缺 pending、raw trim与原fullhash／首次publication／临界长度／容量限制的恢复用例。原 `tests/book-composition-timeline.unit.test.cjs` 保存历史迁移来源边界用例，`tests/structure-writes.unit.test.cjs` 补可选 defaults／trim、字典必需项拒绝、扩展保留和raw／原key恢复用例。本轮全部未运行，不能按测试文件数量计算通过数。

> 白话比喻：原请求像快递柜取件单，草稿像包裹的备注。只检查备注不能证明取件单完整。对应代码：连接填写只是 EmbeddingDraft，恢复还必须校验原请求键及原配置修订；坏取件单不换新单，也不当作包裹不存在。

> 速记方法：草稿管填写，原单管恢复；校验全输入，未知不清键。

## 全批统一验证条件与顺序（计划，未执行）

1. 原授权任务及已发现必要修复全部完成编码，各分工 DONE，主任务完成静态交叉 review，执行队列必要剩余编码为 0；不得用历史“进入统一验证”措辞代替当前判断。
2. 在同一批统一阶段按新设计本包现有锁文件安装依赖，再运行双端类型／构建和明确选取的单位／负向 HTTP／独立边界用例。不能把只覆盖三份旧单位文件的默认 test 命令当所有新增能力验收；不先用遍历所有 tests 的命令误触数据库或真实模型。
3. PG／HTTP 必须先静态核实测试 harness 的数据库、容器、端口和卷隔离。仅设置 NEW_DESIGN_DATA_DIR 不证明 Docker 数据卷隔离；不盲跑会 rebuild、truncate 或迁移用户开发库的用例。任何破坏性步骤仍须明确授权、完成备份及恢复／文件验证。
4. 实际文字／嵌入模型必须有明确专用连接、凭据和原合同配置，单独记录实际调用、回复、用量和恢复结果。缺环境时如实记录未执行，不用模拟结果冒充真实模型。
5. UI／主题／输入法／长章节默认交用户体验验收；SQL 未应用、图像生成 `generation=false`、历史坏凭证或失效来源保持单列真实风险。达到编码条件仅表示可安排统一检查，不表示迁移、模型、界面或全站恢复已通过。
