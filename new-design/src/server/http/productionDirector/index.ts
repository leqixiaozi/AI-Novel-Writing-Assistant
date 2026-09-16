import {Router} from "express";
import {z} from "zod";
import {directorCreateSchema,directorCommandSchema} from "../../../common/productionDirector";
import {getDirectorWorkspace,getDirectorRun,getDirectorReceipt,createDirectorRun,DirectorWriteError,directorRecovery} from "../../database/productionDirector";
import {dispatchDirectorCommand} from "../../application/productionDirector";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
const uuid=z.string().uuid();
export function productionDirectorRouter():Router{
  const router=Router();
  const fail=(error:unknown,book:unknown,step:string,write=false,runId?:unknown)=>{const problem=new AiExecutionError(step,error instanceof NewDesignError?error.message:error instanceof z.ZodError?'章节范围或请求格式不完整，请核对选择。':'导演结果未确认，请保留原凭证并只读核对。',error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,error instanceof NewDesignError?error.issues:undefined);const scope=uuid.safeParse(book),run=uuid.safeParse(runId);if(scope.success){Object.assign(problem.recovery,directorRecovery(scope.data,step,problem.message));if(run.success)problem.recovery.sourceRoute+=`?run=${run.data}`;}if(write)problem.recovery.mutationOutcome=error instanceof DirectorWriteError?error.mutationOutcome:error instanceof z.ZodError?'not_written':'unknown';return problem;};
  router.get('/books/:bookId/director',async(req,res,next)=>{try{res.json({success:true,data:await getDirectorWorkspace(uuid.parse(req.params.bookId))});}catch(error){next(fail(error,req.params.bookId,'读取全书导演'));}});
  router.get('/books/:bookId/director/receipts/:key',async(req,res,next)=>{try{res.json({success:true,data:await getDirectorReceipt(uuid.parse(req.params.bookId),uuid.parse(req.params.key))});}catch(error){next(fail(error,req.params.bookId,'只读核对原导演操作'));}});
  router.get('/books/:bookId/director/runs/:id',async(req,res,next)=>{try{res.json({success:true,data:await getDirectorRun(uuid.parse(req.params.bookId),uuid.parse(req.params.id))});}catch(error){next(fail(error,req.params.bookId,'读取原导演章边界',false,req.params.id));}});
  router.post('/books/:bookId/director/runs',async(req,res,next)=>{try{res.json({success:true,data:await createDirectorRun(uuid.parse(req.params.bookId),directorCreateSchema.parse(req.body))});}catch(error){next(fail(error,req.params.bookId,'保存导演章节范围',true));}});
  router.post('/books/:bookId/director/runs/:id/commands',async(req,res,next)=>{try{res.json({success:true,data:await dispatchDirectorCommand(uuid.parse(req.params.bookId),uuid.parse(req.params.id),directorCommandSchema.parse(req.body))});}catch(error){next(fail(error,req.params.bookId,'提交导演来源页动作',true,req.params.id));}});
  return router;
}
