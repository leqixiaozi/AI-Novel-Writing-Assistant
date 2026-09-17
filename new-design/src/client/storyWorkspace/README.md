# 故事设定与故事规划

本模块提供 story-setting 与 planning 两个书内工作区。复用标准业务表单、规划版本及其原 API，不创建第二套资料或事实账本。旧 setting、world、characters、cards、views 深链接继续有效。

设定通过 tab、selected、detail、relation 保存当前位置。规划通过 tab、scope、selected、plan、display、detail 保存范围及位置；旧 plan hash 可读取。returnTo 只接受同一本书的 planning 地址。范围按规划父子关系取后代，缺失标识与重复来源参数阻止误选。

规划版本 content 的 eventSchedule 保存事件发生次序及作者时间说明，relationshipPlans 保存人物关系意图；两者均为计划，不修改结算事实。其他自定义 content、资料身份及版本引用沿原保存合同保留。

离开脏表单提供保存、放弃、取消。原提交未知时保留完整原请求并阻止重复提交；只读刷新不能证明请求未写入。设定对象初始值与章内历史、当前状态、快照分开。

AI 复用当前单项候选与明确采用能力。正式书籍的整组设定、范围批量规划无现成合同，本模块没有伪造按钮或自动循环执行。新增事件时间及关系意图目前需要人工填写。初始值和规划保存缺少完整按原请求读取的服务合同，未知结果必须保留后核对。

验证使用 noEmit 与 story-workspace、planning-ai-interaction、book-navigation 单元检查；真实模型及采用写入不能用静态测试代替。
