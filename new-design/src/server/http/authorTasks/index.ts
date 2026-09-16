import {Router,type NextFunction,type Response} from "express";
import {z} from "zod";
import {getAuthorTask,listAuthorTasks,authorTaskFilterSchema,authorTaskKindSchema} from "../../database/authorTasks";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
const defaults={getAuthorTask,listAuthorTasks};
/** The route exposes reads only. Workflow mutations stay on their source pages. */
export function authorTasksRouter(dependencies:Partial<typeof defaults>={}):Router {
  const router=Router(),store={...defaults,...dependencies};
  const respond=(response:Response,next:NextFunction,run:()=>Promise<unknown>)=>{
    void Promise.resolve().then(run).then(data=>response.json({success:true,data})).catch(error=>{
      const validation=error instanceof z.ZodError;
      const failure=new AiExecutionError("读取运行记录",validation?"请核对筛选条件和分页凭证。":error instanceof NewDesignError?error.message:"运行记录暂时未读取，请刷新核对或打开原创作来源页。",validation?422:error instanceof NewDesignError?error.status:503);
      Object.assign(failure.recovery,{savedResult:"读取失败不改变创作任务、人工草稿、模型结果或采用回执。",sourceRoute:"/new-design/operations/records",actionLabel:"打开运行记录",mutationOutcome:"not_written"});
      next(failure);
    });
  };
  router.get("/author-tasks",(request,response,next)=>respond(response,next,()=>store.listAuthorTasks(authorTaskFilterSchema.parse(request.query))));
  router.get("/author-tasks/:kind/:id",(request,response,next)=>respond(response,next,()=>store.getAuthorTask(authorTaskKindSchema.parse(request.params.kind),z.string().uuid().parse(request.params.id))));
  const readOnly=(_request:unknown,response:Response)=>response.status(405).json({success:false,error:"运行记录仅供查看，请返回对应创作来源页操作。"});
  router.all("/author-tasks",readOnly);router.all("/author-tasks/:kind/:id",readOnly);
  return router;
}
