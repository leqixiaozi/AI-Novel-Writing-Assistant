import {Router} from 'express';
import {z} from 'zod';
import {getCharacterResources,resourceLedgerQuerySchema} from '../../database/characterResources';
export function characterResourcesRouter(){
 const router=Router();
 router.get('/books/:bookId/characters/:characterId/resource-ledger',(request,response,next)=>{void Promise.resolve().then(()=>getCharacterResources(z.string().uuid().parse(request.params.bookId),z.string().uuid().parse(request.params.characterId),resourceLedgerQuerySchema.parse(request.query))).then(data=>response.json({success:true,data})).catch(next);});
 return router;
}
