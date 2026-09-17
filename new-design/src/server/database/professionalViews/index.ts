import {z} from 'zod';
import type {ProfessionalGrowthEntry,ProfessionalViewsWorkspace} from '../../../common/professionalViews';
import {getWorldCharacterMaintenanceWorkspace,professionalDisplay} from '../worldCharacterMaintenance';
import {getBookCompositionTimelineWorkspace} from '../bookComposition/timeline';
import {getNewDesignPool} from '../runtime';
import {getBookInTransaction} from '../templateStore';
import {NewDesignError} from '../../domain/errors';
import {professionalWritingAction} from '../worldCharacterMaintenance/presentation';
import {validateFieldValue} from '../../domain/validation';
import {validateDictionaryTreeValues} from '../treeResources';

export async function getProfessionalViewsWorkspace(bookId:string):Promise<ProfessionalViewsWorkspace>{
 const id=z.string().uuid().parse(bookId);
 const [source,timeline]=await Promise.all([getWorldCharacterMaintenanceWorkspace(id,{mode:'character'}),getBookCompositionTimelineWorkspace(id)]);
 if(source.book.id!==id||timeline.bookId!==id)throw new NewDesignError('专业图形来源不属于当前书籍，未使用其他书籍替代。',409);
 const client=await(await getNewDesignPool()).connect();
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const book=await getBookInTransaction(client,id);if(book.status!=='active'||book.spaceId!==source.book.spaceId)throw new NewDesignError('本书来源范围已变化，请保留填写并重新读取。',409);
  const rows=(await client.query(`SELECT change.*,card.current_version_id exact_card_version,
   session.id session_id,
   (change.status='active' AND settlement.status='committed' AND settlement.book_id=change.book_id AND settlement.chapter_document_id=change.chapter_document_id AND settlement.body_version_id=change.body_version_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id AND body.archived_at IS NULL) source_valid
   FROM new_design.state_changes change
   JOIN new_design.cards card ON card.id=change.subject_id AND card.space_id=$2 AND card.status='active'
   JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character'
   JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
   JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id
   JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
   LEFT JOIN new_design.chapter_adoption_sessions session ON session.settlement_id=settlement.id AND session.book_id=change.book_id AND session.chapter_document_id=document.id AND session.body_version_id=body.id
   WHERE change.book_id=$1 AND change.subject_kind='card'
   ORDER BY change.effective_story_order NULLS LAST,change.sequence LIMIT 501`,[id,book.spaceId])).rows;
  const labels=new Map(source.objects.map(object=>[object.id,object.title]));
  const dictionaryRows=(await client.query(`SELECT item.dictionary_id,item.id,version.label FROM new_design.dictionary_items item JOIN new_design.dictionary_definitions definition ON definition.id=item.dictionary_id JOIN new_design.dictionary_item_versions version ON version.id=item.current_version_id AND version.item_id=item.id WHERE item.status='active' AND definition.status='published' AND version.status='active' AND (definition.owner_space_id IS NULL OR definition.owner_space_id=$1)`,[book.spaceId])).rows;
  const dictionaryLabels=new Map<string,string>(dictionaryRows.map(row=>[`${row.dictionary_id}:${row.id}`,String(row.label)]));
  const growth:ProfessionalGrowthEntry[]=[];for(const row of rows.slice(0,500)){
   const object=source.objects.find(object=>object.id===row.subject_id),field=object?.fields.find(item=>item.field.key===row.state_key)?.field;
   const valueIssue=field?validateFieldValue(field,row.after_json)??Object.values(await validateDictionaryTreeValues(client,[field],{[field.key]:row.after_json}))[0]??null:'正式字段缺失';
   const available=Boolean(row.source_valid)&&Boolean(field)&&!valueIssue&&Boolean(object?.versionId)&&!object?.unavailableReason&&object?.versionId===row.exact_card_version;
   growth.push({id:String(row.id),subjectId:String(row.subject_id),subjectLabel:object?.title??'人物来源需核对',fieldLabel:field?.name??'历史状态字段需核对',before:professionalDisplay(row.before_json,field,labels,dictionaryLabels),after:professionalDisplay(row.after_json,field,labels,dictionaryLabels),storyOrder:row.effective_story_order===null?null:Number(row.effective_story_order),sequence:Number(row.sequence),recordedAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at),reason:String(row.reason),available,reasonUnavailable:available?null:'历史流水、当前采用正文或正式字段已变化；此记录保留，不作为当前状态。',action:professionalWritingAction(id,String(row.chapter_document_id),row.session_id?String(row.session_id):null,String(row.subject_id))});
  }
  const result:ProfessionalViewsWorkspace={book:source.book,objects:source.objects,relations:source.relations,states:source.states,knowledge:source.knowledge,growth,timeline,truncated:source.truncated||rows.length>500,notes:['图形只是已有正式资料、关系与章节流水的另一种看法；编辑仍回到同一份中文表单。','各原只读来源分别核对，页面不是跨模块冻结快照；保存与采用时由原正本重新验证修订。','成长按已记录故事顺序排列；没有故事顺序的记录放在末尾，记录时间不冒充故事时间。','关系表是关系正本；AGE 如已启用只提供可重建投影，本页不依赖 AGE 可用性。']};
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
