import { createIndependentApplication } from "./index";
import { startNewDesignRuntimeServices } from "../runtime";
import { createTransferBackgroundHandlers } from "../transfers";
import { createPublicationExportBackgroundHandlers } from "../publicationExport";
import { getNewDesignPool, stopNewDesignDatabase } from "../database/runtime";
import type { PrivateRuntimeServices } from "../runtime";

export async function startIndependentServer() {
  if (process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME === undefined) process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME = "1";
  const port = Number(process.env.NEW_DESIGN_HTTP_PORT ?? "5301");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("服务端口必须在 1024–65535 范围内。");
  const app = createIndependentApplication();
  let workers: PrivateRuntimeServices | null = null;
  const server = app.listen(port, "127.0.0.1");
  server.on("listening", () => console.log(`小说创作独立 API：http://127.0.0.1:${port}/api/new-design/independent-health；开发页面：http://127.0.0.1:5273/new-design`));
  server.on("error", () => { console.error(`失败阶段：服务端口监听。恢复：释放 ${port} 端口或设置 NEW_DESIGN_HTTP_PORT 后执行 npm run dev:server；已有数据未清空。`); process.exitCode = 1; void workers?.stop(); });
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  app.locals.independentStartup = { phase: "database", database: "starting", workers: "pending" };
  try {
    await getNewDesignPool();
    app.locals.independentStartup = { phase: "workers", database: "ready", workers: "starting" };
    workers = await startNewDesignRuntimeServices({ ...createTransferBackgroundHandlers(), ...createPublicationExportBackgroundHandlers() });
    app.locals.independentStartup = { phase: "ready", database: "ready", workers: "ready" };
  } catch {
    const databaseReady = app.locals.independentStartup.database === "ready";
    app.locals.independentStartup = { phase: "failed", failedStep: databaseReady ? "后台处理器启动" : "数据库启动与迁移校验", database: databaseReady ? "ready" : "failed", workers: "failed" };
    console.error(`失败阶段：${app.locals.independentStartup.failedStep}。已有数据保留。恢复：启动 Docker Desktop，打开 /new-design/structure/maintenance 核对数据库；然后在新设计目录执行 npm run dev:server。只读检查：/api/new-design/independent-health。`);
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await workers?.stop();
    await stopNewDesignDatabase();
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  return { server, stop };
}

if (require.main === module) void startIndependentServer().catch(() => {
  console.error("失败阶段：服务入口配置或监听。恢复：在新设计目录检查 NEW_DESIGN_HTTP_PORT 为 1024–65535 且未占用，执行 npm run dev:server；已有数据库未清空。");
  process.exitCode = 1;
});
