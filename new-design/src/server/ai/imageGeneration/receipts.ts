import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {link,lstat,mkdir,open,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {imageReplySchema,type ImageGenerationReply} from "../../../common/imageGeneration";
import {imageMaterialScopeSchema,imagePreparationOutputSchema} from '../../../common/imagePreparation';
import {characterAuthorOutputSchema} from '../../../common/characterAuthor';
import {publicTitleOutputSchema} from '../../../common/publicTitles';
import {publicDialogueOutputSchema} from '../../../common/publicCharacters';
import {stableHash} from "../../database/aiContracts";
import {NewDesignError} from "../../domain/errors";
const requestShape={requestId:z.string().uuid(),attemptId:z.string().uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/)};
const bookRefs=z.object({bookId:z.string().uuid(),...requestShape}).strict();
const publicRefs=z.object({scopeKind:z.literal('public_character'),resourceId:z.string().uuid(),resourceVersionId:z.string().uuid(),...requestShape}).strict();
const refsSchema=z.union([bookRefs,publicRefs]);
const replyShape={contract:z.literal("image_reply_v1"),reply:imageReplySchema,replyHash:z.string().regex(/^[a-f0-9]{64}$/)};
const dialogueRefs=publicRefs.extend({scopeKind:z.literal('public_character_dialogue')}).strict();
const dialogueReply=z.object({output:publicDialogueOutputSchema,execution:z.record(z.string(),z.unknown())}).strict();
const preparationRefs=z.object({scopeKind:z.literal('image_prompt_preparation'),scope:imageMaterialScopeSchema,...requestShape}).strict();
const preparationReply=z.object({output:imagePreparationOutputSchema,execution:z.record(z.string(),z.unknown())}).strict();
const authorRefs=z.object({scopeKind:z.literal('character_author'),bookId:z.string().uuid(),cardId:z.string().uuid(),...requestShape}).strict();
const authorReply=z.object({output:characterAuthorOutputSchema,execution:z.record(z.string(),z.unknown())}).strict();
const titleRefs=publicRefs.extend({scopeKind:z.literal('public_title_factory')}).strict();
const titleReply=z.object({output:publicTitleOutputSchema,execution:z.record(z.string(),z.unknown())}).strict();
const allRefsSchema=z.union([bookRefs,publicRefs,dialogueRefs,preparationRefs,authorRefs,titleRefs]);
const schema=z.union([titleRefs.extend({contract:z.literal('public_title_factory_reply_v1'),reply:titleReply,replyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),authorRefs.extend({contract:z.literal('character_author_reply_v1'),reply:authorReply,replyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),bookRefs.extend(replyShape).strict(),publicRefs.extend(replyShape).strict(),dialogueRefs.extend({contract:z.literal('public_character_dialogue_reply_v1'),reply:dialogueReply,replyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),preparationRefs.extend({contract:z.literal('image_prompt_preparation_reply_v1'),reply:preparationReply,replyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]);
export type PublicTitleReplyReferences=z.infer<typeof titleRefs>;
export type CharacterAuthorReplyReferences=z.infer<typeof authorRefs>;
export type ImagePreparationReplyReferences=z.infer<typeof preparationRefs>;
export type PublicDialogueReplyReferences=z.infer<typeof dialogueRefs>;
type StoredReplyReferences=z.infer<typeof allRefsSchema>;
export type ImageReplyReferences=z.infer<typeof refsSchema>;
const appRoot=path.resolve(__dirname,"../../../.."),root=path.join(appRoot,"data","ai-receipts","image-generation"),maxBytes=15*1024*1024;
const errno=(value:unknown,code:string)=>typeof value==='object'&&value!==null&&'code' in value&&value.code===code;
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const failure=()=>new NewDesignError("原图片回复本地凭证未完成核对；保留原请求，不重新生成图片。",503);
async function syncDir(folder:string){if(process.platform==='win32')return;const file=await open(folder,constants.O_RDONLY|constants.O_NOFOLLOW);try{await file.sync();}finally{await file.close();}}
async function folder(refs:StoredReplyReferences,create:boolean){let current=appRoot;const base=await lstat(current);if(!base.isDirectory()||base.isSymbolicLink()||!same(await realpath(current),current))throw failure();for(const part of [...path.relative(appRoot,root).split(path.sep),...("scopeKind" in refs&&refs.scopeKind==='character_author'?["character-author",refs.bookId,refs.cardId]:"scope" in refs?["image-prompt-preparation",refs.scope.kind==="book"?refs.scope.bookId:refs.scope.resourceId]:"bookId" in refs?[refs.bookId]:[refs.scopeKind==='public_title_factory'?'public-title-factory':refs.scopeKind==='public_character_dialogue'?'public-character-dialogue':'public-character',refs.resourceId])]){const parent=current;current=path.join(current,part);let made=false;if(create)try{await mkdir(current,0o700);made=true;}catch(error){if(!errno(error,'EEXIST'))throw error;}let info;try{info=await lstat(current);}catch(error){if(!create&&errno(error,'ENOENT'))return null;throw error;}if(!info.isDirectory()||info.isSymbolicLink()||!same(await realpath(current),current))throw failure();if(made)await syncDir(parent);}return current;}
const filename=(refs:StoredReplyReferences)=>`${refs.requestId}-${refs.attemptId}.json`;
async function read(target:string,refs:StoredReplyReferences):Promise<ImageGenerationReply|z.infer<typeof dialogueReply>|z.infer<typeof preparationReply>|z.infer<typeof authorReply>|z.infer<typeof titleReply>|null>{let before;try{before=await lstat(target);}catch(error){if(errno(error,'ENOENT'))return null;throw error;}if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<=0||before.size>maxBytes)throw failure();const file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.dev!==before.dev||info.ino!==before.ino||info.size!==before.size)throw failure();const bytes=Buffer.alloc(info.size);let offset=0;while(offset<bytes.length){const piece=await file.read(bytes,offset,bytes.length-offset,offset);if(!piece.bytesRead)throw failure();offset+=piece.bytesRead;}const after=await file.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw failure();const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw failure();const value=schema.parse(JSON.parse(text));const {contract:_contract,reply:_reply,replyHash:_replyHash,...storedRefs}=value;if(stableHash(storedRefs)!==stableHash(refs)||value.replyHash!==stableHash(value.reply))throw failure();return value.reply;}finally{await file.close();}}
export async function readImageReply(input:ImageReplyReferences){try{const refs=refsSchema.parse(input),dir=await folder(refs,false),reply=dir?await read(path.join(dir,filename(refs)),refs):null;return reply===null?null:imageReplySchema.parse(reply);}catch{throw failure();}}
export async function readPublicDialogueReply(input:PublicDialogueReplyReferences){try{const refs=dialogueRefs.parse(input),dir=await folder(refs,false),reply=dir?await read(path.join(dir,filename(refs)),refs):null;return reply===null?null:dialogueReply.parse(reply);}catch{throw failure();}}
async function writeReply(input:StoredReplyReferences,output:ImageGenerationReply|z.infer<typeof dialogueReply>|z.infer<typeof preparationReply>|z.infer<typeof authorReply>|z.infer<typeof titleReply>){let temp:string|null=null;try{const refs=allRefsSchema.parse(input),title="scopeKind" in refs&&refs.scopeKind==='public_title_factory',author="scopeKind" in refs&&refs.scopeKind==='character_author',preparation="scopeKind" in refs&&refs.scopeKind==='image_prompt_preparation',dialogue="scopeKind" in refs&&refs.scopeKind==='public_character_dialogue',reply=title?titleReply.parse(output):author?authorReply.parse(output):preparation?preparationReply.parse(output):dialogue?dialogueReply.parse(output):imageReplySchema.parse(output),value=schema.parse({...refs,contract:title?"public_title_factory_reply_v1":author?"character_author_reply_v1":preparation?"image_prompt_preparation_reply_v1":dialogue?"public_character_dialogue_reply_v1":"image_reply_v1",reply,replyHash:stableHash(reply)}),dir=await folder(refs,true);if(!dir)throw failure();const target=path.join(dir,filename(refs)),existing=await read(target,refs);if(existing){if(stableHash(existing)!==value.replyHash)throw failure();return;}const bytes=Buffer.from(JSON.stringify(value),'utf8');if(bytes.length>maxBytes)throw failure();temp=path.join(dir,`pending-${randomUUID()}.tmp`);const file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await folder(refs,false);try{await link(temp,target);}catch(error){if(!errno(error,'EEXIST'))throw error;await unlink(temp);temp=null;const other=await read(target,refs);if(!other||stableHash(other)!==value.replyHash)throw failure();return;}await unlink(temp);temp=null;await syncDir(dir);const published=await read(target,refs);if(!published||stableHash(published)!==value.replyHash)throw failure();}catch{throw failure();}finally{if(temp)await unlink(temp).catch(()=>undefined);}}

export const writeImageReply=(input:ImageReplyReferences,output:ImageGenerationReply)=>writeReply(refsSchema.parse(input),imageReplySchema.parse(output));
export const writePublicDialogueReply=(input:PublicDialogueReplyReferences,output:z.infer<typeof dialogueReply>)=>writeReply(dialogueRefs.parse(input),dialogueReply.parse(output));

export async function readImagePreparationReply(input:ImagePreparationReplyReferences){try{const refs=preparationRefs.parse(input),dir=await folder(refs,false),reply=dir?await read(path.join(dir,filename(refs)),refs):null;return reply===null?null:preparationReply.parse(reply);}catch{throw failure();}}
export const writeImagePreparationReply=(input:ImagePreparationReplyReferences,output:z.infer<typeof preparationReply>)=>writeReply(preparationRefs.parse(input),preparationReply.parse(output));

export async function readCharacterAuthorReply(input:CharacterAuthorReplyReferences){try{const refs=authorRefs.parse(input),dir=await folder(refs,false),reply=dir?await read(path.join(dir,filename(refs)),refs):null;return reply===null?null:authorReply.parse(reply);}catch{throw failure();}}
export const writeCharacterAuthorReply=(input:CharacterAuthorReplyReferences,output:z.infer<typeof authorReply>)=>writeReply(authorRefs.parse(input),authorReply.parse(output));

export async function readPublicTitleReply(input:PublicTitleReplyReferences){try{const refs=titleRefs.parse(input),dir=await folder(refs,false),reply=dir?await read(path.join(dir,filename(refs)),refs):null;return reply===null?null:titleReply.parse(reply);}catch{throw failure();}}
export const writePublicTitleReply=(input:PublicTitleReplyReferences,output:z.infer<typeof titleReply>)=>writeReply(titleRefs.parse(input),titleReply.parse(output));
