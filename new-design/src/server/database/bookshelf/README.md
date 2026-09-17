# 书架读模型与归档边界

书架和阅读采用 REPEATABLE READ READ ONLY，复用 home 模块公开的事实查询与投影，不建立第二书籍链。全部未完成开书 session、有效 book 封面精确引用、正式采用正文和归档书籍在同一快照读取。chapter_body_versions 没有 book_id；必须经 chapter_documents 同时核对 bookId、documentId 和 adopted_version_id，不能假设版本有此列。曾采用的历史版本通过 chapter_body_adoptions.to_version_id 排除，不能计为待采用候选。

归档使用原 books.status='archived'；恢复改为 active。没有迁移、永久删除、回收站清空或草稿删除。事务锁原 book FOR UPDATE，核对原 expectedRevision，变更状态并只增一次 revision；完全相同的转移重放返回已有结果，恢复后重放旧归档不能再归档。COMMIT 回执不确定时只读核对原状态转移。

归档门禁复用运行记录模块的事务内来源查询，拒绝运行、排队、暂停、待恢复及未知执行/回执占用。额外从 information_schema 核对所有已有 book_id/status 原生记录，覆盖未投影到运行记录的请求与后台作业；资源自身的 ready 不是活动任务，只有正式任务来源的 ready 阻止归档。失败及已结束记录保留；不代替用户取消、暂停或恢复任务。

本机单 API 进程的 HTTP 写请求共用生命周期互斥门禁，在途写请求期间拒绝归档/恢复，归档事务期间拒绝新 HTTP 写请求。book 路径及 body.bookId 写请求先拒绝归档作品。此进程门禁不代替多实例分布式协调；若支持多 API 实例或独立任务调度器，必须为原生写入者补充同一事务归档锁，并在领取任务时核对书籍 active 状态，再开放该部署方式的归档。归档前发现可恢复/在途任务时保持原状态并返回来源，不能隐藏作品后放任后台继续写。
