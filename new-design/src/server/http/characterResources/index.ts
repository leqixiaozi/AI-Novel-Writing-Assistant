import {Router} from 'express';
import {z} from 'zod';
import {getCharacterResources,resourceLedgerQuerySchema} from '../../database/characterResources';
import {resourceFocusRouter} from './focus';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {getCharacterResourceHistory} from '../../database/characterResources/history';
export function characterResourcesRouter(ai?:NewDesignAiGateway){
 const router=Router();
 router.get('/books/:bookId/characters/:characterId/resource-history',(request,response,next)=>{void Promise.resolve().then(()=>getCharacterResourceHistory(z.string().uuid().parse(request.params.bookId),z.string().uuid().parse(request.params.characterId),resourceLedgerQuerySchema.parse(request.query) as import('../../../common/characterResources').ResourceLedgerSelection)).then(data=>response.json({success:true,data})).catch(next);});
 router.get('/books/:bookId/characters/:characterId/resource-ledger',(request,response,next)=>{void Promise.resolve().then(()=>getCharacterResources(z.string().uuid().parse(request.params.bookId),z.string().uuid().parse(request.params.characterId),resourceLedgerQuerySchema.parse(request.query))).then(data=>response.json({success:true,data})).catch(next);});
 router.use(resourceFocusRouter(ai));return router;
}
