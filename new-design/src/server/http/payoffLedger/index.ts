import {Router} from 'express';
import {z} from 'zod';
import {savePayoffWindowInputSchema} from '../../../common/payoffLedger';
import {getPayoffLedger,getPayoffWindowRequest,savePayoffWindow} from '../../database/payoffLedger';

const uuid=z.string().uuid();

/** Mounted by the new-design root router; no legacy service is called. */
export function payoffLedgerRouter():Router{
  const router=Router();
  router.get('/books/:bookId/payoff-ledger',(request,response,next)=>{
    void Promise.resolve().then(()=>getPayoffLedger(uuid.parse(request.params.bookId)))
      .then(data=>response.json({success:true,data})).catch(next);
  });
  router.get('/books/:bookId/payoff-ledger/window-requests/:idempotencyKey',(request,response,next)=>{
    void Promise.resolve().then(()=>getPayoffWindowRequest(uuid.parse(request.params.bookId),uuid.parse(request.params.idempotencyKey)))
      .then(data=>response.json({success:true,data})).catch(next);
  });
  router.put('/books/:bookId/payoff-ledger/:cardId/window',(request,response,next)=>{
    void Promise.resolve().then(()=>savePayoffWindow(uuid.parse(request.params.bookId),uuid.parse(request.params.cardId),savePayoffWindowInputSchema.parse(request.body)))
      .then(data=>response.json({success:true,data})).catch(next);
  });
  return router;
}
