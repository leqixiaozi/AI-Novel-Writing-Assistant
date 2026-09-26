import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import * as defaults from '../../database/resourceSupplements';
import {resourceSupplementPreviewInputSchema,resourceSupplementStartInputSchema} from '../../../common/resourceSupplements';
import {resourceSupplementCorrectionPreviewInputSchema,resourceSupplementCorrectionStartInputSchema} from '../../../common/resourceSupplements/correction';
import {resourceSupplementImpactReviewInputSchema} from '../../../common/resourceSupplements/review';
import {resourceSupplementCommitInputSchema} from '../../../common/resourceSupplements/commit';
import {AiExecutionError} from '../../ai';
import {NewDesignError} from '../../domain/errors';
const uuid=z.string().uuid();
const queryInput=(request:Request):unknown=>{const text=z.string().max(50000).parse(request.query.input);try{return JSON.parse(text);}catch{throw new NewDesignError('原请求格式未能读取，请保留完整原凭证。',422);}};
/** Source page actions only. GET never recovers, resumes, imports or resolves. */
export function resourceSupplementsRouter(dependencies:Partial<typeof defaults>={}){
 const store={...defaults,...dependencies},router=Router(),base='/books/:bookId/resource-supplements',session=`${base}/sessions/:sessionId`;
 const book=(request:Request)=>uuid.parse(request.params.bookId),id=(request:Request)=>uuid.parse(request.params.sessionId);
 const respond=(request:Request,response:Response,next:NextFunction,step:string,run:()=>Promise<unknown>,status=200)=>{
  void Promise.resolve().then(run).then(data=>response.status(status).json({success:true,data})).catch(error=>{
   const validation=error instanceof z.ZodError,known=error instanceof NewDesignError;
   const failure=new AiExecutionError(step,validation?'请核对完整来源和原请求格式；当前填写保留。':known?error.message:'服务未能确认结果，请保留完整原请求，只读核对后再继续。',validation?422:known?error.status:503);
   failure.recovery.savedResult='原采用正文、全部确认、已保存候选与原请求凭证保留；读取失败不表示保存失败。';
   const parsedBook=uuid.safeParse(request.params.bookId);
   failure.recovery.sourceRoute=parsedBook.success?`/new-design/books/${parsedBook.data}/writing`:'/new-design/books';
   failure.recovery.actionLabel='返回章节创作核对';
   failure.recovery.mutationOutcome=validation?'not_written':error instanceof defaults.ResourceSupplementError?error.mutationOutcome:'unknown';
   next(failure);
  });
 };
 router.get(`${base}/chapters/:documentId`,(q,s,n)=>respond(q,s,n,'读取原稳定章节来源',()=>store.getResourceSupplementChapterBasis(book(q),uuid.parse(q.params.documentId))));
 router.get(`${base}/characters/:characterId/issues`,(q,s,n)=>respond(q,s,n,'读取人物资源冲突',()=>store.listResourceSupplementIssues(book(q),uuid.parse(q.params.characterId))));
 router.get(`${base}/issues/:issueId`,(q,s,n)=>respond(q,s,n,'读取原资源冲突依据',()=>store.getResourceSupplementIssueSource(book(q),uuid.parse(q.params.issueId))));
 router.get(`${session}/source`,(q,s,n)=>respond(q,s,n,'读取完整原补充来源',()=>store.getResourceSupplementSource(book(q),id(q))));
 router.get(`${base}/preview`,(q,s,n)=>respond(q,s,n,'核对稳定章资源范围',()=>store.previewResourceSupplement(book(q),resourceSupplementPreviewInputSchema.parse(queryInput(q)))));
 router.post(base,(q,s,n)=>respond(q,s,n,'准备独立资源补充清单',()=>store.startResourceSupplement(book(q),resourceSupplementStartInputSchema.parse(q.body)),201));
 router.get(`${base}/original`,(q,s,n)=>respond(q,s,n,'只读核对原补充结果',()=>store.readResourceSupplementStartOriginal(book(q),resourceSupplementStartInputSchema.parse(queryInput(q)))));
 router.get(`${base}/corrections/preview`,(q,s,n)=>respond(q,s,n,'核对资源冲突实际章前依据',()=>store.previewResourceSupplementCorrection(book(q),resourceSupplementCorrectionPreviewInputSchema.parse(queryInput(q)))));
 router.post(`${base}/corrections`,(q,s,n)=>respond(q,s,n,'准备独立资源修正清单',()=>store.startResourceSupplementCorrection(book(q),resourceSupplementCorrectionStartInputSchema.parse(q.body)),201));
 router.get(`${base}/corrections/original`,(q,s,n)=>respond(q,s,n,'只读核对原修正结果',()=>store.readResourceSupplementCorrectionStartOriginal(book(q),resourceSupplementCorrectionStartInputSchema.parse(queryInput(q)))));
 router.get(`${session}/impact`,(q,s,n)=>respond(q,s,n,'核对实际结算影响',()=>store.previewResourceSupplementSettlement(book(q),id(q))));
 router.post(`${session}/impact-reviews`,(q,s,n)=>respond(q,s,n,'明确确认完整结算影响',()=>store.confirmResourceSupplementSettlementImpact(book(q),id(q),resourceSupplementImpactReviewInputSchema.parse(q.body)),201));
 router.get(`${session}/impact-original`,(q,s,n)=>respond(q,s,n,'只读核对原影响确认',()=>store.readResourceSupplementImpactReviewOriginal(book(q),id(q),resourceSupplementImpactReviewInputSchema.parse(queryInput(q)))));
 router.post(`${session}/commit`,(q,s,n)=>respond(q,s,n,'正式保存资源补充结果',()=>store.commitResourceSupplement(book(q),id(q),resourceSupplementCommitInputSchema.parse(q.body))));
 router.get(`${session}/commit-original`,(q,s,n)=>respond(q,s,n,'只读核对原正式补充结果',()=>store.readResourceSupplementCommitOriginal(book(q),id(q),resourceSupplementCommitInputSchema.parse(queryInput(q)))));
 router.post(`${session}/correction-commit`,(q,s,n)=>respond(q,s,n,'正式保存资源修正',()=>store.commitResourceSupplementCorrection(book(q),id(q),resourceSupplementCommitInputSchema.parse(q.body))));
 router.get(`${session}/correction-commit-original`,(q,s,n)=>respond(q,s,n,'只读核对原正式修正结果',()=>store.readResourceSupplementCorrectionCommitOriginal(book(q),id(q),resourceSupplementCommitInputSchema.parse(queryInput(q)))));
 return router;
}
