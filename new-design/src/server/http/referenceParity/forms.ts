import {Router} from "express";
import {z} from "zod";
import {getReferenceForms,previewReferenceForm,installReferenceForm,selectReferenceForm,readReferenceFormReceipt,previewReferenceInstanceUpgrade,upgradeReferenceInstance,readReferenceInstanceUpgradeReceipt,previewReferenceAssociations,publishReferenceAssociations} from "../../database/referenceParity";
import {getNewDesignPool} from "../../database/runtime";
import {readStructureWriteReceipt,structureWriteHash,StructureWriteError} from "../../database/structureWrites";
import {formPreviewSchema,formInstallSchema,formSelectSchema,instanceUpgradeSchema,associationPublicationPreviewSchema,associationPublicationSchema} from "./formSchema";
const uuid=z.string().uuid();
export function referenceFormsRouter(){
  const router=Router();
  const run=(work:(req:any)=>Promise<unknown>)=>async(req:any,res:any,next:any)=>{try{res.json({success:true,data:await work(req)});}catch(error){next(error);}};
  router.get('/books/:bookId/reference-forms',run(req=>getReferenceForms(uuid.parse(req.params.bookId))));
  router.get('/books/:bookId/form-selection',run(async req=>{const bookId=uuid.parse(req.params.bookId),row=(await(await getNewDesignPool()).query("SELECT id,revision,installed_payload->'activeForms' active_forms FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0];if(!row)throw new Error('书籍不存在。');return{bookId,bookRevision:Number(row.revision),activeForms:row.active_forms??{}};}));
  router.post('/books/:bookId/reference-forms/preview',run(req=>previewReferenceForm(uuid.parse(req.params.bookId),formPreviewSchema.parse(req.body))));
  router.post('/books/:bookId/reference-forms/install',run(req=>installReferenceForm(uuid.parse(req.params.bookId),formInstallSchema.parse(req.body))));
  router.post('/books/:bookId/reference-forms/select',run(req=>selectReferenceForm(uuid.parse(req.params.bookId),formSelectSchema.parse(req.body))));
  router.post('/books/:bookId/reference-forms/install-receipt',run(req=>readReferenceFormReceipt(uuid.parse(req.params.bookId),formInstallSchema.parse(req.body),'reference_form_install')));
  router.post('/books/:bookId/reference-forms/select-receipt',run(req=>readReferenceFormReceipt(uuid.parse(req.params.bookId),formSelectSchema.parse(req.body),'reference_form_select')));
  router.post('/books/:bookId/reference-forms/instance-preview',run(req=>{const input=z.object({instanceId:uuid,targetFormVersionId:uuid}).strict().parse(req.body);return previewReferenceInstanceUpgrade(uuid.parse(req.params.bookId),input.instanceId,input.targetFormVersionId);}));
  router.post('/books/:bookId/reference-forms/instance-upgrade',run(req=>upgradeReferenceInstance(uuid.parse(req.params.bookId),instanceUpgradeSchema.parse(req.body))));
  router.post('/books/:bookId/reference-forms/instance-receipt',run(req=>readReferenceInstanceUpgradeReceipt(uuid.parse(req.params.bookId),instanceUpgradeSchema.parse(req.body))));
  router.post('/reference-associations/preview',run(req=>{const input=associationPublicationPreviewSchema.parse(req.body);return previewReferenceAssociations(input.sourceTemplateVersionId,input.primaryTypeKeys);}));
  router.post('/reference-associations/publish',run(req=>publishReferenceAssociations(associationPublicationSchema.parse(req.body))));
  router.post('/reference-associations/receipt',run(async req=>{const input=associationPublicationSchema.parse(req.body),saved=await readStructureWriteReceipt('template',input.requestKey);if(!saved)return null;if(saved.operation!=='publish'||saved.inputHash!==structureWriteHash({kind:'template',operation:'publish',input:{command:'reference_association_template',...input}}))throw new StructureWriteError('template','publish','原关联模板回执与完整输入不同。',409,'unknown');return saved.result;}));
  return router;
}
