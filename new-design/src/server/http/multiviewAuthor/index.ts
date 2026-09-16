import {Router} from "express";
import {z} from "zod";
import {getBookMultiviewAuthorWorkspace} from "../../database/multiviewAuthor";
import {AiExecutionError} from "../../ai";
import {NewDesignError} from "../../domain/errors";
export function multiviewAuthorRouter(dependencies={getBookMultiviewAuthorWorkspace}):Router {const router=Router();router.get("/books/:id/multiview-author-workspace",async(req,res,next)=>{try{const id=z.string().uuid().parse(req.params.id);res.json({success:true,data:await dependencies.getBookMultiviewAuthorWorkspace(id)});}catch(error){const failure=new AiExecutionError("读取本书多维筛选来源",error instanceof NewDesignError?error.message:error instanceof z.ZodError?"书籍恢复来源无效，请从我的书籍重新打开。":"底座未确认读取结果，请保留当前条件，检查运行维护后只读刷新。",error instanceof NewDesignError?error.status:error instanceof z.ZodError?422:503,null,error instanceof NewDesignError?error.issues:undefined);failure.recovery.savedResult="搜索、筛选、选中位置与编辑草稿保留；本次只读取，不写入资料或调用模型。";const valid=z.string().uuid().safeParse(req.params.id);if(valid.success){failure.recovery.sourceRoute=`/new-design/books/${valid.data}/views/chapters`;failure.recovery.actionLabel="返回多维视图";}next(failure);}});return router;}
