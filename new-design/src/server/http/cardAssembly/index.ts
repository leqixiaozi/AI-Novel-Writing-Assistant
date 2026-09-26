import {Router} from 'express';
import {z} from 'zod';
import type {BookAssembly,CardTemplateGraph} from '../../../common/cardAssembly';
import {NewDesignError} from '../../domain/errors';
import {fieldDefinitionSchema} from '../../domain/validation';
import {getNewDesignPool} from '../../database/runtime';
import {findRecordCard,listRecordCards} from '../../database/recordCards';
import {listDefinitions,listDefinitionVersions,publishDefinition,saveDefinition,listAssemblyRelationTypes} from '../../database/cardAssembly/catalog';
import {addBookModuleInstance} from '../../database/cardAssembly/install';
import {reviseBookRootCard} from '../../database/cardAssembly/root';
import {fillBookTemplateSlot,confirmBookTemplateRelation,createBookInstanceRelation} from '../../database/cardAssembly/slots';
import {getBookAssemblyWorkspace} from '../../database/cardAssembly/workspace';
import {listBookTemplateImpact} from '../../database/cardAssembly/impact';
import {listTemplates,listTemplateVersions,publishTemplate,saveTemplate} from '../../database/templateStore';

const uuid=z.string().uuid();
const position=z.object({x:z.number().finite().optional(),y:z.number().finite().optional(),width:z.number().positive().finite().optional(),height:z.number().positive().finite().optional()});
const metaSlot=position.extend({id:uuid,metaVersionId:uuid,required:z.boolean()});
const edge=z.object({id:uuid,kind:z.enum(['membership','card_relation']),from:uuid,to:uuid,relationTypeVersionId:uuid.optional(),required:z.boolean().optional(),label:z.string().max(160).optional()});
const graph=z.object({slots:z.array(metaSlot).max(500),edges:z.array(edge).max(1000),frame:position.extend({x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive(),collapsed:z.boolean().optional()}).optional()});
const assembly=z.object({root:position.extend({id:uuid,metaVersionId:uuid}),modules:z.array(position.extend({id:uuid,cardTemplateId:uuid,cardTemplateVersionId:uuid,initialInstanceCount:z.number().int().min(0).max(100),collapsed:z.boolean().optional()})).max(100),standalone:z.array(metaSlot).max(500),edges:z.array(edge).max(1000)});
const definition=z.object({id:uuid.optional(),key:z.string().min(2).max(64),name:z.string().trim().min(1),description:z.string().default(''),category:z.string().default(''),kind:z.enum(['book_root','ordinary']).optional(),fields:z.array(fieldDefinitionSchema.strict()).max(100).optional(),graph:graph.optional(),expectedRevision:z.number().int().positive().optional()});
const bookTemplate=z.object({id:uuid.optional(),key:z.string().min(2),name:z.string().trim().min(1),description:z.string().default(''),assembly,expectedRevision:z.number().int().positive().optional()});
const publish=z.object({expectedRevision:z.number().int().positive(),requestKey:z.string().optional()});
const success=(res:import('express').Response,data:unknown,status=200)=>res.status(status).json({success:true,data});

export function cardAssemblyRouter():Router{
  const router=Router();
  for(const [path,kind] of [['meta-cards','meta_card'],['card-templates','card_template']] as const){
    router.get(`/${path}`,async(_req,res)=>success(res,await listDefinitions(kind)));
    router.get(`/${path}/:id/versions`,async(req,res)=>success(res,await listDefinitionVersions(kind,String(req.params.id))));
    router.post(`/${path}`,async(req,res)=>{
      const input=definition.parse(req.body);
      if(input.id&&input.expectedRevision===undefined)throw new NewDesignError('修改定义时必须提交修订号。',422);
      success(res,await saveDefinition(kind,{...input,fields:input.fields as import('../../../common/contracts').FieldDefinition[]|undefined,graph:input.graph as CardTemplateGraph|undefined}),input.id?200:201);
    });
    router.post(`/${path}/:id/publish`,async(req,res)=>{
      const input=publish.parse(req.body);
      success(res,await publishDefinition(kind,String(req.params.id),input.expectedRevision));
    });
  }
  router.get('/assembly-relation-types',async(_req,res)=>success(res,await listAssemblyRelationTypes()));
  router.get('/book-templates',async(_req,res)=>success(res,(await listTemplates()).filter(row=>row.draftConfig?.assembly)));
  router.get('/book-templates/:id/versions',async(req,res)=>success(res,(await listTemplateVersions(String(req.params.id))).filter(version=>(version.payload as {assembly?:unknown}).assembly)));
  router.get('/book-template-versions/:id/root-fields',async(req,res)=>{
    const db=await getNewDesignPool(),version=await findRecordCard(db,uuid.parse(req.params.id),'template_group_version');
    const assembly=(version?.payload as {assembly?:BookAssembly}|undefined)?.assembly;
    if(!assembly)throw new NewDesignError('书籍模板版本不存在。',404);
    const meta=await findRecordCard(db,assembly.root.metaVersionId,'meta_card_version');
    if(!meta)throw new NewDesignError('书籍信息字段版本不存在。',422);
    success(res,{versionId:version!.id,metaVersionId:meta.id,fields:meta.fields});
  });
  router.get('/book-templates/:id/impact',async(req,res)=>success(res,await listBookTemplateImpact(String(req.params.id),uuid.parse(req.query.targetVersionId))));
  router.post('/book-templates',async(req,res)=>{
    const input=bookTemplate.parse(req.body);
    if(input.id&&input.expectedRevision===undefined)throw new NewDesignError('修改书籍模板时必须提交修订号。',422);
    success(res,await saveTemplate({id:input.id,key:input.key,name:input.name,description:input.description,draftConfig:{assembly:input.assembly as BookAssembly},revision:input.expectedRevision}),input.id?200:201);
  });
  router.post('/book-templates/:id/publish',async(req,res)=>{
    const input=publish.parse(req.body);
    success(res,await publishTemplate(String(req.params.id),input.expectedRevision,input.requestKey));
  });
  router.get('/books/:id/template-slots',async(req,res)=>{
    const db=await getNewDesignPool();
    success(res,await listRecordCards(db,'book_template_slot',{where:{book_id:String(req.params.id)}}));
  });
  router.get('/books/:id/assembly',async(req,res)=>success(res,await getBookAssemblyWorkspace(String(req.params.id))));
  router.patch('/books/:id/root-card',async(req,res)=>{
    const input=z.object({expectedBookRevision:z.number().int().positive(),expectedCardRevision:z.number().int().positive(),values:z.record(z.string(),z.unknown())}).parse(req.body);
    success(res,await reviseBookRootCard({...input,bookId:String(req.params.id)}));
  });
  router.get('/books/:id/module-instances',async(req,res)=>{
    const db=await getNewDesignPool();
    success(res,await listRecordCards(db,'book_template_module_instance',{where:{book_id:String(req.params.id)}}));
  });
  router.get('/books/:id/template-relations',async(req,res)=>{
    const db=await getNewDesignPool();
    success(res,await listRecordCards(db,'book_template_pending_relation',{where:{book_id:String(req.params.id)}}));
  });
  router.post('/books/:id/template-slots/:slotId/fill',async(req,res)=>{
    const input=z.object({expectedRevision:z.number().int().positive(),title:z.string().trim().min(1),values:z.record(z.string(),z.unknown())}).parse(req.body);
    success(res,await fillBookTemplateSlot({...input,bookId:String(req.params.id),slotId:String(req.params.slotId)}),201);
  });
  router.post('/books/:id/template-relations/:relationId/confirm',async(req,res)=>{
    const input=z.object({expectedRevision:z.number().int().positive(),properties:z.record(z.string(),z.unknown()).default({})}).parse(req.body);
    success(res,await confirmBookTemplateRelation({...input,bookId:String(req.params.id),pendingRelationId:String(req.params.relationId)}),201);
  });
  router.post('/books/:id/instance-relations',async(req,res)=>{
    const input=z.object({fromSlotId:uuid,toSlotId:uuid,relationTypeVersionId:uuid,properties:z.record(z.string(),z.unknown()).default({})}).parse(req.body);
    success(res,await createBookInstanceRelation({...input,bookId:String(req.params.id)}),201);
  });
  router.post('/books/:id/module-instances',async(req,res)=>{
    const input=z.object({moduleRefNodeId:uuid}).parse(req.body),client=await(await getNewDesignPool()).connect();
    try{await client.query('BEGIN');const result=await addBookModuleInstance(client,{bookId:String(req.params.id),moduleRefNodeId:input.moduleRefNodeId});await client.query('COMMIT');success(res,result,201)}
    catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  });
  return router;
}
