# 故事设定与故事规划

本模块提供 story-setting 与 planning 两个书内工作区。复用标准业务表单、规划版本及其原 API，不创建第二套资料或事实账本。旧 setting、world、characters、cards、views 深链接继续有效。

设定通过 tab、selected、detail、relation 保存当前位置。规划通过 tab、scope、selected、plan、display、detail 保存范围及位置；旧 plan hash 可读取。returnTo 只接受同一本书的 planning 地址。范围按规划父子关系取后代，缺失标识与重复来源参数阻止误选。

规划版本 content 的 eventSchedule 保存事件发生次序及作者时间说明，relationshipPlans 保存人物关系意图；两者均为计划，不修改结算事实。其他自定义 content、资料身份及版本引用沿原保存合同保留。

离开脏表单提供保存、放弃、取消。原提交未知时保留完整原请求并阻止重复提交；只读刷新不能证明请求未写入。设定对象初始值与章内历史、当前状态、快照分开。

BatchAiPanel 使用 story_workspace_ai_v1 原请求及冻结来源准备整组设定／范围规划候选。设定只补空白；规划已有字段默认不勾选，事件时间和关系意图可作为结构化计划建议。候选逐项载入原编辑器，明确采用勾选字段后正常保存；规划还须单独采用版本，不写正文或结算事实。

原请求保留在 sessionStorage，刷新只读取原批次；结果未知时不能重发，明确结束运行占用保留未知结果及用量。运行记录链接携带 batch 标识返回原候选。载入前检查来源指纹／修订／采用依据；迟到读取受序号与书籍范围保护。

规划 pending 凭证包含实际发送的完整创建／修订输入，按原 planning_operation_events 哈希核对；初始值请求 UUID 指向原不可变初始值版本，核对规范输入哈希。没有完整原凭证的旧未知请求保持待核对，不用当前读到的相似资料补造成功。

验证使用 noEmit 与 story-workspace、planning-ai-interaction、book-navigation 单元检查；真实模型及采用写入不能用静态测试代替。
