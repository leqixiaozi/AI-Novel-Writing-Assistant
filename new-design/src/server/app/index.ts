import express from "express";
import path from "node:path";
import fs from "node:fs";
import { createIndependentAiGateway } from "../ai";
import { createNewDesignRouter } from "../http/router";
import {getNewDesignPool} from '../database/runtime';

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
      const state=(await pool.query("SELECT EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='123_card_workflow_convergence') started,EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='131_card_kernel_v2_cutover') finished,to_regclass('new_design.system_capabilities') IS NOT NULL capability_table")).rows[0]??{};
      if(!state.started)return next();
      if(!state.finished||!state.capability_table)return response.status(503).json({success:false,error:'卡片内核 v2 正在原子升级，所有业务写入已停用。',recovery:{failedStep:'等待数据库收敛完成',summary:'数据库处于 123–131 部分安装状态。',savedResult:'已有作者数据和原请求保留；不要重复提交。',mutationOutcome:'not_written',sourceRoute:'/new-design/structure/maintenance',actionLabel:'打开运行维护'}});
      const capability=(await pool.query("SELECT installed,operational FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2'")).rows[0]??{};
      if(!capability.installed||!capability.operational)return response.status(503).json({success:false,error:'卡片内核 v2 维护门禁未解除，所有业务写入已停用。',recovery:{failedStep:'核对数据库能力',summary:'最终结构或保护检查尚未通过。',savedResult:'已有作者数据和原请求保留；不要重复提交。',mutationOutcome:'not_written',sourceRoute:'/new-design/structure/maintenance',actionLabel:'打开运行维护'}});
      next();
    }).catch(next);
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
