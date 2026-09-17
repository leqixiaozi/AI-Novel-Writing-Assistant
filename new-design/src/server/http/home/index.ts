import { Router } from "express";
import { MODEL_TASKS } from "../../../common/modelRouting";
import { getHomeSnapshot } from "../../database/home";
import { getInitializedNewDesignPool } from "../../database/runtime";
import { getIndependentTaskAvailability } from "../../ai";

export function homeRouter(): Router {
  const router = Router();
  router.get("/snapshot", (_request, response) => {
    void getHomeSnapshot().then(data => response.json({ success: true, data })).catch(() => {
      response.status(503).json({ success: false, error: "创作进展暂未读取完整，请重新读取；已有作品和任务保留。" });
    });
  });
  router.get("/models", (_request, response) => {
    void getInitializedNewDesignPool().then(async () => {
      const tasks = await Promise.all(MODEL_TASKS.map(async task => ({
        label: task.label,
        configured: (await getIndependentTaskAvailability(task.key)).configured,
      })));
      return { configured: tasks.every(task => task.configured), tasks };
    }).then(data => response.json({ success: true, data })).catch(() => {
      response.status(503).json({ success: false, error: "暂未读取模型配置，请重新读取或打开模型设置核对。" });
    });
  });
  return router;
}
