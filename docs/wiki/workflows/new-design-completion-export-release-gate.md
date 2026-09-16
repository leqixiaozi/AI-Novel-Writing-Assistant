# 新设计：完本、导出与发布验收

F8 形成三条可追溯链：完本检查快照、不可变导出 manifest/产物、Release Gate 证据。创作人员在“完本与导出”处理作品范围；维护人员在“运行维护”查看 PostgreSQL、任务、备份和发布风险。

正式稿绑定当前快照并只包含连续稳定范围；审阅稿允许未稳定的采用正文但带提示。导出先冻结章节版本，再由既有 Outbox 作业生成 Markdown、UTF-8 TXT 或 DOCX；来源变化返回 409。

数据同步分两层：Git 搬运 001—045 SQL、代码与说明；PostgreSQL 逻辑备份/书籍包搬运作者数据和审计账本。受管附件按 manifest 搬运，运行中的数据目录不能直接复制。

详细合同：`new-design/docs/completion-export-runtime-maintenance.md`、`new-design/docs/release-gate-checklist.md`、`new-design/docs/transfer-backup-import-export.md`、`new-design/docs/private-runtime-runbook.md`。
