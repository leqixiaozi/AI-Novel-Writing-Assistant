import {Router,type Request,type Response,type NextFunction} from 'express';
import {z} from 'zod';
import {bookHistorySaveSchema,bookHistoryRestoreSchema} from '../../../common/bookHistory';
import {getBookHistoryWorkspace,previewBookHistory,saveBookHistory,prepareBookHistoryRestore,readBookHistorySave,readBookHistoryRestore,BookHistoryError} from '../../database/bookHistory';
import {NewDesignError} from '../../domain/errors';
export function bookHistoryRouter(){
 const router=Router(),uuid=z.string().uuid(),empty=z.object({}).strict(),page=z.object({before:uuid.optional()}).strict();
 const run=(req:Request,res:Response,next:NextFunction,work:(bookId:string)=>Promise<unknown>)=>{const parsed=uuid.safeParse(req.params.bookId);if(!parsed.success){next(new NewDesignError('本书标识不完整。',422));return;}void Promise.resolve().then(()=>work(parsed.data)).then(data=>res.json({success:true,data})).catch(error=>next(error instanceof BookHistoryError?error:new BookHistoryError(parsed.data,error instanceof z.ZodError?'历史输入或恢复选择不完整，原填写保留。':error instanceof NewDesignError?error.message:'原历史结果未确认，请保留原键只读核对。',error instanceof z.ZodError?422:error instanceof NewDesignError?error.status:503,error instanceof z.ZodError&&req.method==='POST'?'not_written':'unknown')));};
 router.get('/:bookId/workspace',(req,res,next)=>run(req,res,next,book=>getBookHistoryWorkspace(book,page.parse(req.query).before)));
 router.get('/:bookId/:id/preview',(req,res,next)=>run(req,res,next,book=>{empty.parse(req.query);return previewBookHistory(book,uuid.parse(req.params.id));}));
 router.post('/:bookId/save',(req,res,next)=>run(req,res,next,book=>saveBookHistory(book,bookHistorySaveSchema.parse(req.body))));
 router.post('/:bookId/prepare-restore',(req,res,next)=>run(req,res,next,book=>prepareBookHistoryRestore(book,bookHistoryRestoreSchema.parse(req.body))));
 router.get('/:bookId/save-by-key/:key',(req,res,next)=>run(req,res,next,book=>{empty.parse(req.query);return readBookHistorySave(book,uuid.parse(req.params.key));}));
 router.get('/:bookId/restore-by-key/:key',(req,res,next)=>run(req,res,next,book=>{empty.parse(req.query);return readBookHistoryRestore(book,uuid.parse(req.params.key));}));
 return router;
}
