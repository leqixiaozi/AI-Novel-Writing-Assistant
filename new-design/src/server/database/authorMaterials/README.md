# 统一作者资料写入与原请求凭证

新设计表单通过 `createAuthorMaterial(bookId,input)`、`updateAuthorMaterial(bookId,cardId,input)` 保存同一份 cards/card_versions 正本；旧公开端点行为合同不扩展。新增 HTTP 为 POST/PATCH `/books/:bookId/author-materials[/cardId]`，GET `/books/:bookId/author-material-write-receipts?requestKey=uuid` 只读精确核对。

保存凭证像收银小票：付款与小票一起完成，不能通过货架上商品相似猜付款成功。对应技术上，062 只给已有 card_versions 追加 book/requestKey/inputHash/immutable receipt 元信息，不造第二份事实。速记：原键、原输入、同事务。

写入在原 store.createCard/updateCardSnapshot 事务中获取按 book/requestKey 的 advisory xact lock。服务端确认 book space、目标 card/type；相同键+相同输入返回冻结旧凭证，相同键+不同输入拒绝。字典快照、独立补充值、标签成员与 AI provenance 和凭证同物理事务保存，COMMIT 前映射回执，COMMIT 后不读取最新状态猜结果。

失败像刷卡时收银机断线：没有小票不能断定没扣款。对应技术上，只有 COMMIT 尚未开始且 ROLLBACK 真实成功才标记 not_written；COMMIT/ROLLBACK 不明均 unknown。只读原请求查询也持有同键锁；null 不能证明未执行。前端持久原键与草稿，unknown 只读核对；有明确 not_written 且已读核对后，作者确认差异再用新键重新准备。

062 增量仅编写，由根迁移注册；本阶段不应用。测试用例只编写，所有剩余编码完成后一次集中验证。

## 调用者持有的原子事务

`updateAuthorMaterialInTransaction(client,bookId,cardId,input)` 供明确批量作者命令使用，不自行 BEGIN／COMMIT／释放连接。它复用 store.updateCardInTransaction 的同一校验、当前规格／实际活跃表单判断、card_versions、补充值、字典快照、标签、AI 来源和作者回执；不是第二份保存实现。store 的单项公开保存仍自行管理原事务及提交失败分类。批量调用者必须在所有项目成功和整批原回执完成后一次提交，任何项失败回滚全批；未知提交只读原请求，不自动重放。
