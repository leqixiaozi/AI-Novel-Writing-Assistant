# 正文选区编辑器

`BodyEditor({value,onChange,disabled,actions?})` 通过 `BodyEditorHandle.getSelection()` 返回已冻结的原文 UTF-16 偏移。`actions` 只提供自定义中文按钮和冻结选区回调，不调用模型、不保存正文、不采纳版本。

Tiptap 是内存段落投影，正文唯一来源仍是章节工作台 `draft` 与既有正文候选版本。当前储存合同是纯文本，Markdown 标记作为原文保留；不提供会丢失保存结果的富文本格式按钮。不把 HTML 或 JSON 作为另一份正文保存。空段落、末尾换行、中文及 Unicode 按原文往返。

对话框冻结 PM 位置、原文偏移、选中文字、文档结构及编辑修订；失焦不依赖浏览器当前选区。确认前复核完整结构与修订，替换先在事务草案核对完整预期正文，然后一次 dispatch；任何范围外变化都会拒绝，不提交事务。撤销／重做由现有编辑历史管理。外部载入正文增加修订并失效旧选区；输入法组合态不打开／执行选区修改。

依赖固定 `@tiptap/core/react/pm/starter-kit` 3.31.3，npm 官方元信息与 MIT 许可已在编码前只读核对，React 19 在 peer 范围内。未运行 CLI 模板生成器或采购商业包，不复制官方 UI／字体／样式。核心依赖自带许可；来源见 [MIT 许可](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md)、[React](https://tiptap.dev/docs/editor/getting-started/install/react)、[BubbleMenu](https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu)。

仅源码静态 review；用例 `tests/body-editor.unit.test.cjs` 未运行。中文输入法、跨段替换、撤销、保存重开、长正文和主题交互在全队列编码完成后统一验证，不能用纯函数用例代替实际交互验收。
