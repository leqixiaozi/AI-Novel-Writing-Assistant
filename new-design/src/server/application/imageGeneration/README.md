# 专属单图生成与原回复恢复

本模块是新设计的独立图片执行链，不读取旧项目图片密钥、网关或配置，不使用默认文字模型，不自动选模型、不下载远程图片、不调用第二个模型。初版仅接受作者明确配置的 `openai_images_b64_v1` 协议：兼容图片生成端点、一次一张、直接图片内容，尺寸也须在原连接版本中明确声明。兼容协议不代表任意厂商模型都支持；需作者自行确认实际服务能力。本批没有真实外部调用或界面验收。

> 白话比喻：先指定照相馆和套餐，再拿同一取件单取照片；照片取回后才决定贴在哪里。对应系统：连接版本与输入冻结，未知按原请求核对，原回复只入库成候选，采用和绑定分别确认。

> 速记方法：选专属、冻原单、只一拍、留原图、再采用。

## 原事实与执行顺序

专属连接复用 `model_route_configs/versions/ai_contract_publications/model_credential_refs`，范围为任务组 `image_generation`，能力必须为 `image_generation + image_base64`；单图预算，零自动重试、无备用。凭据只是原新设计环境变量引用，HTTP 不接受密钥正文。

每个请求在同一物理事务冻结正式系统图像配方、任务合同、空显式上下文和精确原模型快照，登记原 `ai_tasks/steps/attempts`，发送领取证据也先提交。只有首次正向提交且返回 `dispatch` 的调用才执行一次图像协议；原键重复、回执未知或只读 GET 永不调用模型。原键绑定完整输入哈希，包括本书、连接版本、用途、标题、说明、画面要求及尺寸，不按内容相近猜测成功。

079 只为原 attempt 加不可变 `image_freeze`，为原 append-only 事件加原回复 `image_reply`，发送与回复各有单次唯一索引。没有新增图片事实表，也没有放宽原 attempt 状态转换或已完成记录保护。

合法单图回复先保存 `data/ai-receipts/image-generation/<书籍>/<原请求>-<原尝试>.json`：限定目录与原 UUID、普通文件、无符号链接、原输入哈希和回复哈希核对、独占临时文件同步、硬链接不覆盖发布。它只是原调用证据，不是图片资产或已采用事实；缺失凭证不是未调用证明。

`completeSavedImageGeneration` 只读取这个原回复，校验实际图像内容、SHA-256 和大小后，通过原 `visualAssets.saveVisualCandidateInTransaction` 在同一事务写受控文件、原资产/版本/视觉回执、真实或未知用量、原任务终态。版本来源 `ai_generated`，保留原 task、attempt、连接版本；不采用、不绑定、不修改正文。图片上限 10 MiB，仅 PNG/JPEG/WebP，拒绝 SVG、远程 URL、多图和不规范编码。价格、缺失 token 和完成情况不伪造为零。

共享原资产写入函数也正向核对本书原 task/attempt、原 key/fullhash、冻结连接版本及原回复的实际图片摘要和大小，不能仅凭 caller 标记把普通上传伪称模型生成。

## 失败与恢复

提交确认丢失：保留原键，只读 `by-key`。已收到原图但后续入库失败：原本地回复保留，明确点击“继续保存原图片回复”；不重新生成。目录刷新失败：已经获得的成功资产回执保留，不把保存成功改为保存失败。

过期且没有读取到原回复：作者明确确认后结束旧未知领取；原调用和用量仍未知，原记录保留，不能称为模型没有执行。已保存回复不能通过这个入口丢弃为未执行。结束后迟到回复不能覆盖终态或继续入库；本地证据可保留。COMMIT 未开始且回滚有 ACK 才说明本次数据库未写入；COMMIT/回滚未知保守锁定。

> 白话比喻：付款短信没收到，不等于没付款。对应系统：查询不到订单只表示暂未读到，不能换订单再扣一次费。

> 速记方法：未知查原单，续存用原图；不见不猜，无票不重拍。

## HTTP 与中央接线

- `GET /books/:bookId/image-generation/catalog`
- `POST /books/:bookId/image-generation/requests`（`ImageGenerationInput`）
- `GET /books/:bookId/image-generation/by-key/:key`
- `GET /image-generation/requests/:id/result`
- `POST /image-generation/requests/:id/complete-saved`（严格空对象）
- `POST /image-generation/requests/:id/end-expired`（严格空对象）
- `GET /models/image-generation/catalog`
- `POST /models/image-generation/connections`（`SaveImageConnectionInput`）
- `GET /models/image-generation/connections/by-request/:key`
- `GET /models/image-generation/connections/:id`

`imageGenerationRouter()` 使用这些完整路径，由中央挂载；中央须识别 `ImageGenerationError/ImageHttpError` 的 typed recovery，GET 不返回 mutationOutcome。`ImageGenerationApi` 注入原 `VisualAssetsPage.imageApi`，独立专属连接表单在图片页内，不改文字设置行为。正式迁移 registry 与全域任务类型 CHECK 由中央集成，不执行迁移。

本书 catalog 同时返回原图片请求目录 `requests`（优先待核对，最多 20 条）；原结果包含 `input` 的精确冻结画面。恢复记录缺失时，作者可以从本书原请求按钮只读打开，保留当前人工画面，不换键重生成。历史已完成目录只查回复事件元信息，不把每张完整图片编码带到列表；原图内容仍从原资产精确版本读取。

跨机器备份必须同时保留数据库、`data/assets/` 和 `data/ai-receipts/image-generation/`。不得把服务密钥或环境变量正文加入 Git。已有附件、用户开发数据库和服务端口未被本模块开发操作触碰。

## 验证状态

专属 13 项静态/纯 helper 用例已写入 `tests/image-generation.unit.test.cjs`，原视觉静态能力断言同步为“读取真实专属连接”，不再固定 false，均尚未执行。079 尚未应用；类型、构建、HTTP、真实隔离 PostgreSQL、并发 ACK、文件故障恢复与界面验收等待全部阶段编码完成后统一验证。需要合法外部配置才能进行真实模型验收，不能把源码完成说成外部能力已验收。
