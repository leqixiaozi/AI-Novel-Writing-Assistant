import {Router} from 'express';
import {z} from 'zod';
import type {AiRuntimeRecovery} from '../../../common/aiRuntime';
import {getProfessionalViewsWorkspace} from '../../application/professionalViews';
import {NewDesignError} from '../../domain/errors';
export class ProfessionalViewsReadError extends NewDesignError {
 constructor(message:string,status:number,readonly recovery:AiRuntimeRecovery,issues?:Record<string,string>){super(message,status,issues);}
}
export function professionalViewsRouter(){
 const router=Router();
 router.get('/books/:bookId/professional-views/workspace',(req,res,next)=>{
  void Promise.resolve().then(()=>getProfessionalViewsWorkspace(z.string().uuid().parse(String(req.params.bookId)))).then(data=>res.json({success:true,data})).catch(error=>{
   const id=z.string().uuid().safeParse(req.params.bookId),message=error instanceof NewDesignError?error.message:error instanceof z.ZodError?'请选择有效书籍，再读取专业视图。':'读取专业视图暂时失败，请保留原表单和布局，点击重新读取来源。';
   next(new ProfessionalViewsReadError(message,error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,{failedStep:'读取本书专业图形来源',summary:message,savedResult:'本次仅查询来源，没有保存、重新生成、采用或结算；原填写和已保存事实保留。',sourceRoute:id.success?`/new-design/books/${id.data}/professional-views`:'/new-design/structure/maintenance',actionLabel:id.success?'返回专业图形视图':'打开运行维护'},error instanceof NewDesignError?error.issues:undefined));
  });
 });return router;
}
