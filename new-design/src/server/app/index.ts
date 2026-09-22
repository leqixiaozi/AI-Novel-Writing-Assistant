import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createIndependentAiGateway } from "../ai";
import { createNewDesignRouter } from "../http/router";
import {getNewDesignPool} from '../database/runtime';
import {requireTablesOnlyInstallation} from '../database/tablesOnly';

/** The independent entry supplies only new-design-owned adapters, never externally injected old gateways. */
export function createIndependentApplication() {
  const app = express();
  app.disable("x-powered-by");
  app.locals.independentStartup = { phase: "starting", database: "pending", workers: "pending" };
  app.get("/api/new-design/independent-health", (_request, response) => {
    const state = app.locals.independentStartup;
    response.json({ success: true, data: { ...state, recoveryRoute: "/new-design/structure/maintenance", recoveryCommand: "npm run dev", savedData: "启动失败不会清空已有数据库或编辑草稿。" } });
  });
  // UTF-8 uploads remain limited to 2 MiB decoded by the knowledge module.
  // Only controlled image upload needs base64 headroom; decoded bytes remain limited to 10 MiB.
  app.use("/api/new-design/visual-assets/uploads",express.json({limit:"16mb"}));
  app.use(express.json({ limit: "4mb" }));
  app.use('/api/new-design',(request,response,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(request.method))return next();
    void getNewDesignPool().then(async pool=>{
      await requireTablesOnlyInstallation(pool);
      next();
    }).catch(()=>response.status(503).json({success:false,error:'新版纯表结构尚未就绪或处于维护状态，业务写入已停用。',recovery:{failedStep:'核对纯表数据库能力',summary:'需要完整 132 结构与可用能力；服务不会自动执行重建。',savedResult:'已有作者数据和原请求保留；不要重复提交。',mutationOutcome:'not_written',sourceRoute:'/new-design/structure/maintenance',actionLabel:'打开运行维护'}}));
  });
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
    const tooLarge=Boolean(error&&typeof error==='object'&&'type' in error&&error.type==='entity.too.large');
    response.status(tooLarge?413:invalidBody ? 400 : 500).json({ success: false, error:tooLarge?"上传请求超过允许大小，未提交到资料保存；请保留原文件，选择范围内文件后重新准备。":invalidBody ? "请求内容格式不正确，请保留编辑内容并重新提交。" : "请求未能处理，请核对服务器结果后在原页面重试。",...((tooLarge||invalidBody)?{recovery:{failedStep:'检查上传请求',summary:tooLarge?'上传大小超限，请核对原文件大小。':'请求格式未通过解析，请保留填写。',savedResult:'请求未交给业务保存；原文件、已有资料和当前填写保留。',mutationOutcome:'not_written',sourceRoute:'/new-design/structure/maintenance',actionLabel:'打开运行维护'}}:{}) });
  });
  return app;
}
