# 视觉资产 HTTP 边界

`visualAssetsRouter()` 由主 router 挂载，所有路径自带本书或视觉域前缀。GET 本书目录、原请求回执、原影响预览与精确图像内容均只读，不恢复或结束后台任务。POST 上传／命令／预览只接受公共 strict DTO，不能注入模型、URL、存储 locator 或数据库连接。上传的 16 MiB JSON parser 仅主应用精确路径配置，普通请求大小限制不扩展。

二进制内容先核对 book/asset/version、受控普通文件、实际哈希和大小，再返回原 MIME、nosniff、私有重验证、sandbox 与内容哈希 ETag。错误只返回受控中文字段位置与 `VisualSourceError.recovery`，不暴露路径、SQL、堆栈或替代文件。

> 白话比喻：窗口只递出指定照片，不把仓库钥匙交给来访者。对应系统：客户端拿图像字节和版本凭证，不拿任意磁盘路径或 provider 参数。

> 速记方法：请求定本书，字节验原件，路径不出门。

仅静态 review，HTTP 和二进制读取未运行。
