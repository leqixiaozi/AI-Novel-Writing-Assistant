import type {PoolClient} from 'pg';
import type {FrozenWorldCard,WorldInstallInput,WorldInstallTarget} from '../../../common/worldPackages';
import {WORLD_PROFESSIONAL_TYPE_KEYS} from '../../../common/worldCharacterMaintenance';
import {assertFound,NewDesignError} from '../../domain/errors';
import {freezeFormContext} from '../formAssist';
import {resolveBookFormVersion} from '../referenceParity';
import {validateCardValues} from '../../domain/validation';
import {validateDictionaryTreeValues} from '../treeResources';

/** Both full imports and explicit additions use the actual book type, form and
 * dictionary policies before the normal author writer creates the material. */
export async function prepareWorldCard(db:PoolClient,bookId:string,spaceId:string,source:FrozenWorldCard,item:WorldInstallInput['cards'][number],lock=false):Promise<WorldInstallTarget&{typeKey:string}>{
 const target=assertFound((await db.query("SELECT type.id,type.type_key,type.current_version_id,type.revision,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.id=$1 AND type.space_id=$2 AND type.status='published'"+(lock?' FOR SHARE OF type,version':''),[item.targetTypeId,spaceId])).rows[0],'目标内容类型不是本书已发布的规格。');
 if(!(WORLD_PROFESSIONAL_TYPE_KEYS as readonly string[]).includes(target.type_key))throw new NewDesignError('世界资料须映射到本书实际世界内容类型。',422);
 const resolution=await resolveBookFormVersion(db,spaceId,target.type_key);
 const context=await freezeFormContext(db,{bookId,cardTypeId:String(target.id),typeVersionId:String(target.current_version_id),cardId:null,cardRevision:null,formVersionId:resolution?.id??null,title:item.title},{},[]);
 const sourceKeys=Object.keys({...source.values,...source.localValues}),mapped=new Set<string>(),targetKeys=new Set<string>();
 for(const map of item.mapping){if(!sourceKeys.includes(map.sourceKey)||mapped.has(map.sourceKey)||targetKeys.has(map.targetKey)||Object.hasOwn(item.additionalValues,map.targetKey)||!context.fields.some(field=>field.key===map.targetKey&&!field.hidden))throw new NewDesignError('来源或目标字段映射重复、缺失或不可填写，请核对完整原选择。',422);mapped.add(map.sourceKey);targetKeys.add(map.targetKey);}
 const missing=sourceKeys.filter(key=>!mapped.has(key));if(missing.length)throw new NewDesignError('公共世界存在未明确映射的档案或补充字段，没有静默舍弃空值、0或false。',422,Object.fromEntries(missing.map(key=>[key,'请选择本书实际字段并核对映射值。'])));
 if(Object.keys(item.additionalValues).some(key=>!context.fields.some(field=>field.key===key&&!field.hidden)))throw new NewDesignError('额外填写包含本书不可填写的字段。',422);
 const validation=validateCardValues(context.fields,{...item.additionalValues,...Object.fromEntries(item.mapping.map(map=>[map.targetKey,map.value]))});if(Object.keys(validation.issues).length)throw new NewDesignError('请完善本书世界资料的字段填写。',422,validation.issues);
 const issues=await validateDictionaryTreeValues(db,context.fields,validation.values);if(Object.keys(issues).length)throw new NewDesignError('请明确选择本书的实际选项，不能把公共字典节点直接当成本书节点。',422,issues);
 return{sourceCardId:source.cardId,cardTypeId:String(target.id),typeKey:String(target.type_key),typeVersionId:String(target.current_version_id),typeRevision:Number(target.revision),formVersionId:resolution?.id??null,formResolutionKind:resolution?'installed_form':'type_schema',fields:context.fields,sourceHash:context.sourceHash,values:validation.values};
}
