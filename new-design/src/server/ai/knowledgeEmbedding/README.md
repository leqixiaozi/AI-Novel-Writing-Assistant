# 单次受控嵌入与原回复保留

只实现现有原模型连接的两种明确协议：Ollama `POST /api/embed`（`truncate:false`）和 OpenAI-compatible `POST /embeddings`（float 编码）。不借文字 prompt、文字默认路由、备用模型或自动重试；非零配置重试须在原模型设置明确修正。

> 🏠 白话比喻：嵌入像给段落测量一组坐标，不是让模型写另一段故事。对应到传输：原文本只作为嵌入输入，原向量返回后验证精确模型、数量、维度与可索引数值，正文不被改写。
> 🧠 速记方法：一输入、一回复、一组精确维度；断线是未知，不是零，也不是再发一次。

等待预算采用原配置 1000～600000ms，租约为 15 分钟；响应有 256 KiB 上限。PG float4 转换前后均校验，零向量/非有限/溢出/下溢归零拒绝。已收到响应但规格无效属于 completed；发送后断线才是 sent_unknown，结构化 provider 输入 tokens 能读到时原值保留，缺失为 null，不估费用。

原成功回复先保存在 `data/ai-receipts/knowledge-embedding/<book UUID>/<request UUID>-<attempt UUID>.json`，再录入原数据库结果。请求/输入 hash 精确核对，独占临时文件同步 flush、hard-link 不覆盖发布；检查目录非链接、文件普通且单硬链接、限定大小、UTF-8 与完整 reply hash；无端点、凭据、环境变量或配置正文。

它只保留原执行证据，不是第二正文/向量事实库，不证明数据库提交，不允许绕过租约或重发模型。Windows 目录 fsync 不可靠，文件自身仍 flush；目录校验与发布之间的外部目录替换竞争、hard-link 发布到临时文件移除的短窗口仍保留边界，不扩大为全盘锁。文件保存与数据库同时不可用时不能保证保住成功回复，不假称已备份。当前未执行实际目录写入、备份或模型调用。

协议依据：[Ollama 官方嵌入接口](https://docs.ollama.com/api/embed)、[OpenAI 官方嵌入实现](https://github.com/openai/openai-python/blob/main/src/openai/resources/embeddings.py)。
