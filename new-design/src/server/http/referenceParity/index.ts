import {Router} from "express";
import {referenceFormsRouter} from "./forms";
import {associationReceiptsRouter} from "./associationReceipts";
import {z} from "zod";
import {previewReferenceSpecification,publishReferenceSpecification,readReferenceSpecificationReceipt} from "../../database/referenceParity";
import {readFieldWriteReceipt} from "../../database/fieldExtensions";
import {createBookFieldExtensionSchema,createLocalFieldSchema,reviseLocalFieldSchema} from "../../domain/validation";
const uuid=z.string().uuid();
const publish=z.object({kind:z.enum(["profile","visible"]).optional(),sourceTemplateVersionId:uuid,templateRevision:z.number().int().positive(),previewHash:z.string().regex(/^[a-f0-9]{64}$/),requestKey:uuid}).strict();
const fieldReceipt=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("book"),input:createBookFieldExtensionSchema}).strict(),
  z.object({operation:z.literal("card"),cardId:uuid,input:createLocalFieldSchema}).strict(),
  z.object({operation:z.literal("revise"),fieldId:uuid,input:reviseLocalFieldSchema}).strict(),
]);
export function referenceParityRouter(){
  const router=Router();
  router.use(referenceFormsRouter());
  router.use(associationReceiptsRouter());
  router.post("/books/:bookId/field-extensions/receipt",async(req,res,next)=>{try{const bookId=uuid.parse(req.params.bookId),command=fieldReceipt.parse(req.body),operation=command.operation==="book"?"book_field_create":command.operation==="card"?"card_field_create":"card_field_revise",input=command.operation==="card"?{cardId:command.cardId,...command.input}:command.operation==="revise"?{fieldId:command.fieldId,...command.input}:command.input;res.json({success:true,data:await readFieldWriteReceipt(bookId,command.input.idempotencyKey,{operation,input})});}catch(error){next(error);}});
  router.get("/reference-specifications/:versionId",async(req,res,next)=>{try{res.json({success:true,data:await previewReferenceSpecification(uuid.parse(req.params.versionId),z.enum(["profile","visible"]).optional().parse(req.query.kind))});}catch(error){next(error);}});
  router.post("/reference-specifications/publish",async(req,res,next)=>{try{res.json({success:true,data:await publishReferenceSpecification(publish.parse(req.body))});}catch(error){next(error);}});
  router.post("/reference-specifications/receipt",async(req,res,next)=>{try{res.json({success:true,data:await readReferenceSpecificationReceipt(publish.parse(req.body))});}catch(error){next(error);}});
  return router;
}
