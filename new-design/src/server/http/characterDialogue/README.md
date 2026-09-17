# 人物沙盘 HTTP

`characterDialogueRouter()` 挂载 `/api/new-design`；基础路径 `/books/:bookId/character-dialogue`。GET workspace、sessions/by-key、sessions/:session、rounds/by-key、rounds/:id、selections/by-key 均只读原范围。POST 分别保存会话、明确生成单轮、完成/释放原已保存回复、结束已超期未知运行、选择动作到原规划草稿。

所有请求严格解析，入口格式拒绝才可表示本次尚未执行；普通领域 422、未知提交和模型后保存失败不能据状态码推断未写。GET 始终剥离 mutationOutcome，不证明旧写入未发生。

像柜台核验身份证：证件格式在柜台被拒绝，才能明确说这次业务没有办理；不能因为旧档案暂时没查到就说从未办理。对应严格入口错误专属类型与中文字段定位。速记：**格式拒绝 ≠ 旧业务不存在**。
