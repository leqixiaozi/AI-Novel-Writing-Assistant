import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {imageReplySchema,type ImageGenerationReply} from '../../../common/imageGeneration';
import {NewDesignError,assertFound} from '../../domain/errors';
import {decodeVisualUpload,persistVisualBytes,readVisualBytes} from '../visualAssets/files';

/** Trial cards retain image metadata; the original binary stays in controlled storage. */
export async function freezePublicCharacterReply(client:PoolClient,kind:string,value:unknown):Promise<unknown>{
 if(kind!=='portrait')return value;
 const image=imageReplySchema.parse(value),file=decodeVisualUpload({mimeType:image.mimeType,base64:image.base64});
 if(file.checksum!==image.checksum||file.byteSize!==image.byteSize)throw new NewDesignError('原图片回复的内容校验不一致。',409);
 await persistVisualBytes(file);
 const locator='visual-assets/'+file.locator;
 const content=(await client.query("INSERT INTO new_design.asset_content_objects(id,checksum,byte_size,mime_type,storage_kind,storage_provider,storage_locator,integrity_state,last_verified_at,created_by) VALUES($1,$2,$3,$4,'managed_file','local',$5,'verified',now(),'public_characters') ON CONFLICT(checksum_algorithm,checksum,byte_size) DO NOTHING RETURNING *",[randomUUID(),file.checksum,file.byteSize,file.mimeType,locator])).rows[0]??assertFound((await client.query('SELECT * FROM new_design.asset_content_objects WHERE checksum=$1 AND byte_size=$2',[file.checksum,file.byteSize])).rows[0],'原图片内容引用未确认。');
 if(content.storage_kind!=='managed_file'||content.storage_provider!=='local'||![locator,file.locator].includes(String(content.storage_locator))||content.mime_type!==image.mimeType)throw new NewDesignError('原图片已存在不同受控引用，不能覆盖。',409);
 const {base64,...metadata}=image;void base64;
 return{...metadata,imageContentObjectId:String(content.id)};
}

export async function thawPublicCharacterReply(client:PoolClient,kind:string,value:unknown):Promise<unknown>{
 if(kind!=='portrait'||value===null)return value;
 const frozen=value as Record<string,unknown>,content=assertFound((await client.query("SELECT * FROM new_design.asset_content_objects WHERE id=$1 AND storage_kind='managed_file' AND storage_provider='local'",[frozen.imageContentObjectId])).rows[0],'原图片回复的受控内容不存在。');
 if(content.checksum!==frozen.checksum||Number(content.byte_size)!==frozen.byteSize||content.mime_type!==frozen.mimeType)throw new NewDesignError('原图片回复的元数据与受控内容不一致。',409);
 const bytes=await readVisualBytes(String(content.storage_locator).replace(/^visual-assets\//,''),String(content.checksum),Number(content.byte_size),content.mime_type as ImageGenerationReply['mimeType']);
 const {imageContentObjectId,...metadata}=frozen;void imageContentObjectId;
 return imageReplySchema.parse({...metadata,base64:Buffer.from(bytes).toString('base64')});
}
