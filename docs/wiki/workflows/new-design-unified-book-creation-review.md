# 新设计统一开书审阅边界

## Background

不同开书入口会产生不同来源的初始内容，但书籍最终必须使用同一套模板、字段校验和资料安装流程。入口若直接创建书籍，AI 草稿和研究建议就会绕过作者逐项确认，也会让后续功能不得不理解多套创建合同。

## Decision

所有入口只准备 `book_creation_sessions.review_cards`，然后进入同一份审阅表单。审阅集合是创建书籍前唯一的资料输入；最终安装器不再分别读取模板种子、AI 草稿、研究建议和策略资源。

## Current Rule

- 空白入口准备空集合，模板入口准备模板种子，AI 入口准备生成结果，研究与策略入口准备对应来源内容。
- 作者可以编辑当前值、删除预填条目和新增手工条目。
- 来源类型、初始值和不可变来源版本属于审计信息，由服务端锁定；新条目只能是手工来源。
- 保存草稿执行已填字段与字典树规则校验，允许必填项空白；创建复用同一规则并要求必填完整，执行修订号检查且只消费已保存集合。
- AI 失败只能重试或进入审阅表单，不能绕过审阅直接创建。

## Failure Modes

- 不要在前端分别合并多种来源；否则服务端校验和最终安装可能看到不同内容。
- 不要信任客户端回传的来源元数据；否则作者修改表单时可能破坏来源审计。
- 不要让创建接口接受未保存的临时表单；否则并发标签页会覆盖彼此。
- 不要把类型稳定键、UUID 或原始 JSON 暴露到普通开书界面。

## Related Modules

- `new-design/src/server/database/bookCreationStore.ts`
- `new-design/src/server/database/templateStore.ts`
- `new-design/src/client/bookCreation/`
- `new-design/docs/unified-book-creation-form.md`
