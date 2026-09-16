import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createIndependentAiGateway } from "../ai";
import { createNewDesignRouter } from "../http/router";

/** The independent entry supplies only new-design-owned adapters, never externally injected old gateways. */
export function createIndependentApplication() {
  const app = express();
  app.disable("x-powered-by");
  app.locals.independentStartup = { phase: "starting", database: "pending", workers: "pending" };
  app.get("/api/new-design/independent-health", (_request, response) => {
    const state = app.locals.independentStartup;
    response.json({ success: true, data: { ...state, recoveryRoute: "/new-design/structure/maintenance", recoveryCommand: "npm run dev", savedData: "启动失败不会清空已有数据库或编辑草稿。" } });
  });
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/new-design", createNewDesignRouter({ ai: createIndependentAiGateway() }));
  const clientRoot = path.resolve(__dirname, "../../client");
  const documentPath = path.join(clientRoot, "index.html");
  if (fs.existsSync(documentPath)) {
    app.use(express.static(clientRoot));
    app.get(/^\/(?:new-design(?:\/.*)?)?$/, (_request, response) => response.sendFile(documentPath));
  }
  app.get("/", (_request, response) => response.redirect("/new-design"));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const invalidBody = error instanceof SyntaxError && "body" in error;
    response.status(invalidBody ? 400 : 500).json({ success: false, error: invalidBody ? "请求内容格式不正确，请保留编辑内容并重新提交。" : "请求未能处理，请核对服务器结果后在原页面重试。" });
  });
  return app;
}
