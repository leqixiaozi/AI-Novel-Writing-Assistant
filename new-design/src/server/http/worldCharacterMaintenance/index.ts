import {Router} from "express";
import {z} from "zod";
import {getWorldCharacterMaintenanceWorkspace,worldCharacterQuerySchema} from "../../database/worldCharacterMaintenance";
import {NewDesignError} from "../../domain/errors";
import {AiExecutionError} from "../../ai";
/** Read-only projection; mutations use normal author materials or the original chapter workflow. */
export function createWorldCharacterMaintenanceRouter(){const router=Router();router.get("/books/:bookId/world-character/workspace",(request,response,next)=>{
 void Promise.resolve().then(()=>getWorldCharacterMaintenanceWorkspace(z.string().uuid().parse(request.params.bookId),worldCharacterQuerySchema.parse(request.query))).then(data=>response.json({success:true,data})).catch(error=>{
  const issues=error instanceof NewDesignError?error.issues:error instanceof z.ZodError?Object.fromEntries(error.issues.map(issue=>[issue.path.join("."),"请核对所选书籍、资料与维护方式。"] )):undefined;
  const problem=new AiExecutionError("读取世界／人物正式来源",error instanceof NewDesignError?error.message:error instanceof z.ZodError?"请选择本书有效资料与维护视图。":"来源读取暂不可用，请保留当前填写并重新读取来源。",error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,issues);
  problem.recovery.savedResult="本次为只读来源查询；原档案、关系、状态、认知账本和当前填写保留，不能以读取失败判断先前写入结果。";
  const book=z.string().uuid().safeParse(request.params.bookId);problem.recovery.sourceRoute=book.success?`/new-design/books/${book.data}/${request.query.mode==="character"?"characters":"world"}`:"/new-design/structure/maintenance";
  problem.recovery.actionLabel=book.success?"返回专业维护":"打开运行维护";next(problem);
 });});return router;}
