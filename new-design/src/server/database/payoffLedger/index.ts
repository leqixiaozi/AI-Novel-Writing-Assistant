import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {classifyPayoffStatus,type PayoffLedgerItem,type PayoffLedgerSource,type PayoffLedgerWorkspace,type PayoffWindowReceipt,type SavePayoffWindowInput} from '../../../common/payoffLedger';
import {NewDesignError,assertFound} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';

type Row=Record<string,unknown>;
const value=(input:unknown)=>typeof input==='string'?input.trim():'';
const numeric=(input:unknown)=>input===null||input===undefined?null:Number(input);
const iso=(input:unknown)=>input instanceof Date?input.toISOString():new Date(String(input)).toISOString();
const missingRelation=(error:unknown)=>Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='42P01');

function windowReceipt(row:Row):PayoffWindowReceipt{return{
  id:String(row.id),bookId:String(row.book_id),cardId:String(row.card_id),version:Number(row.version),revision:Number(row.revision),
  startChapterOrder:numeric(row.start_chapter_order),endChapterOrder:numeric(row.end_chapter_order),
  idempotencyKey:String(row.idempotency_key),createdAt:iso(row.created_at),
};}

async function windowInstalled(client:Pick<PoolClient,'query'>):Promise<boolean>{
  const result=await client.query("SELECT to_regclass('new_design.payoff_window_versions') IS NOT NULL AND to_regclass('new_design.payoff_windows') IS NOT NULL AS installed");
  return result.rows[0]?.installed===true;
}

async function rows(client:PoolClient,bookId:string,sql:string){return(await client.query(sql,[bookId])).rows as Row[];}
async function serialRows(queries:Array<()=>Promise<Row[]>>){const result:Row[][]=[];for(const query of queries)result.push(await query());return result;}

export async function getPayoffLedger(bookId:string):Promise<PayoffLedgerWorkspace>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const book=assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'书籍不存在或已归档。');
    void book;
    const installed=await windowInstalled(client);
    const [cards,plans,placements,settlements,chapters,scopedFields,windows]=await serialRows([
      ()=>rows(client,bookId,`SELECT card.id,card.card_type_id,card.current_version_id,version.title,version.values,card.updated_at,
          type_version.fields type_fields,type.draft_fields,type.status type_status,
          capability.settlement_capability,capability.state_mode,policy.settlement_policy
        FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active'
        JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='foreshadow'
        JOIN new_design.card_type_versions type_version ON type_version.id=type.current_version_id
        JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
        LEFT JOIN LATERAL (SELECT entry.settlement_capability,entry.state_mode FROM new_design.state_type_capabilities entry
          WHERE entry.type_key='foreshadow' AND entry.space_id IN (book.space_id,'00000000-0000-4000-8000-000000000001'::uuid)
          ORDER BY (entry.space_id=book.space_id) DESC LIMIT 1) capability ON true
        LEFT JOIN LATERAL (SELECT entry.settlement_policy FROM new_design.state_field_policies entry
          WHERE entry.type_key='foreshadow' AND entry.field_key='status'
            AND entry.space_id IN (book.space_id,'00000000-0000-4000-8000-000000000001'::uuid)
          ORDER BY (entry.space_id=book.space_id) DESC LIMIT 1) policy ON true
        WHERE book.id=$1 ORDER BY version.title,card.id`),
      ()=>rows(client,bookId,`SELECT reference.id,reference.card_id,reference.card_version_id,reference.action_key,reference.note,
        object.id object_id,object.title plan_title,object.level,plan.id plan_version_id,document.logical_order
        FROM new_design.planning_objects object
        JOIN new_design.planning_versions plan ON plan.id=object.adopted_version_id AND plan.status='adopted' AND plan.stale_at IS NULL
        JOIN new_design.planning_version_references reference ON reference.planning_version_id=plan.id AND reference.reference_role='foreshadow'
        LEFT JOIN new_design.chapter_documents document ON document.book_id=object.book_id AND document.chapter_card_id=object.card_id AND document.status='active'
        WHERE object.book_id=$1 AND object.status='active'
        ORDER BY document.logical_order NULLS LAST,reference.id`),
      ()=>rows(client,bookId,`SELECT placement.id,placement.subject_card_id,placement.role,chapter.title chapter_title,document.logical_order
        FROM new_design.books book JOIN new_design.narrative_placements placement ON placement.space_id=book.space_id AND placement.status='active'
        JOIN new_design.cards chapter ON chapter.id=placement.chapter_card_id AND chapter.status='active'
        LEFT JOIN new_design.chapter_documents document ON document.book_id=book.id AND document.chapter_card_id=chapter.id AND document.status='active'
        WHERE book.id=$1 AND placement.role IN ('plant','reinforce','reveal','recover') ORDER BY document.logical_order NULLS LAST,placement.id`),
      ()=>rows(client,bookId,`SELECT change.id,change.subject_id,change.after_json,change.sequence,change.state_key,
        document.logical_order,settlement.id settlement_id
        FROM new_design.state_changes change
        JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id AND settlement.status='committed'
        JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.settlement_id=settlement.id AND checkpoint.status='stable'
        JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.status='active'
          AND document.adopted_version_id=settlement.body_version_id
        WHERE change.book_id=$1 AND change.subject_kind='card' AND change.status='active' AND change.state_key='status'
        ORDER BY document.logical_order,change.sequence`),
      ()=>rows(client,bookId,`SELECT document.logical_order,EXISTS(
          SELECT 1 FROM new_design.chapter_stable_checkpoints checkpoint
          JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id AND settlement.status='committed'
          WHERE checkpoint.chapter_document_id=document.id AND checkpoint.status='stable'
            AND document.adopted_version_id=settlement.body_version_id
        ) stable FROM new_design.chapter_documents document
        WHERE document.book_id=$1 AND document.status='active' ORDER BY document.logical_order`),
      ()=>rows(client,bookId,`SELECT definition.card_type_id,definition.card_id,version.field_schema
        FROM new_design.field_definitions definition
        JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id
        JOIN new_design.books book ON book.space_id=definition.space_id
        JOIN new_design.card_types type ON type.id=definition.card_type_id AND type.type_key='foreshadow'
        WHERE book.id=$1 AND definition.status='active' AND definition.scope IN ('book_type','card')
          AND definition.field_key='status'
        ORDER BY definition.created_at,definition.id`),
      ()=>installed?rows(client,bookId,`SELECT pointer.card_id,pointer.revision,version.id,version.book_id,version.version,
          version.start_chapter_order,version.end_chapter_order,version.idempotency_key,version.created_at
          FROM new_design.payoff_windows pointer JOIN new_design.payoff_window_versions version ON version.id=pointer.current_version_id
          WHERE pointer.book_id=$1`):Promise.resolve([] as Row[]),
    ]);
    let throughStableChapterOrder=0;
    for(const chapter of chapters){if(Number(chapter.logical_order)!==throughStableChapterOrder+1||chapter.stable!==true)break;throughStableChapterOrder++;}
    const items:PayoffLedgerItem[]=cards.map(card=>{
      const cardId=String(card.id),cardVersionId=String(card.current_version_id),values=(card.values??{}) as Row;
      const typeFields=Array.isArray(card.type_fields)?card.type_fields as Row[]:[];
      const overrides=scopedFields.filter(field=>String(field.card_type_id)===String(card.card_type_id)&&(field.card_id===null||String(field.card_id)===cardId));
      const override=overrides.at(-1)?.field_schema;
      const statusField=override&&typeof override==='object'&&!Array.isArray(override)?override as Row:typeFields.find(field=>field.key==='status');
      const configured=statusField?.stateSettlement==='lifecycle'||statusField?.stateSettlement==='tracked'||Boolean(statusField?.optionSource&&typeof statusField.optionSource==='object'&&(statusField.optionSource as Row).kind==='dictionary_tree'&&(statusField.optionSource as Row).settleOnChapter);
      const settlementUnavailableReason=card.type_status!=='published'?'本书伏笔内容类型未发布。'
        :configured&&card.settlement_capability==='disabled'||configured&&card.state_mode==='none'?'本书伏笔状态结算能力已关闭。'
        :configured&&['none','derived'].includes(String(card.settlement_policy))?'本书 status 字段结算策略已关闭。'
        :configured?null
        :overrides.length?'本书或对象的 status 局部字段未发布为可结算规格；请核对局部字段。'
        :JSON.stringify(card.draft_fields)!==JSON.stringify(card.type_fields)?'本书伏笔内容类型有未发布草稿；107 手动迁移不会覆盖草稿，请先核对。'
        :!statusField?'本书伏笔类型缺少正式 status 字段，无法在章节结算中选择。'
        :statusField.description!=='作者侧的布置和回收进度'?'本书 status 字段已自定义；107 手动迁移不会改写该规格，请明确发布可结算字段。'
        :'本书 status 字段尚未发布为生命周期结算规格；需核对 107 手动迁移或自定义状态配置。';
      const cardPlans=plans.filter(plan=>String(plan.card_id)===cardId),cardPlacements=placements.filter(placement=>String(placement.subject_card_id)===cardId);
      const cardSettlements=settlements.filter(change=>String(change.subject_id)===cardId),latest=cardSettlements.at(-1);
      const manual=windows.find(window=>String(window.card_id)===cardId);
      const plannedOrders=cardPlans.filter(plan=>plan.level==='chapter'&&plan.action_key==='recover'&&Number.isInteger(numeric(plan.logical_order))).map(plan=>Number(plan.logical_order));
      const start=manual?numeric(manual.start_chapter_order):plannedOrders.length?Math.min(...plannedOrders):null;
      const end=manual?numeric(manual.end_chapter_order):plannedOrders.length?Math.max(...plannedOrders):null;
      const paidOff=latest?.after_json==='paid_off';
      const status=classifyPayoffStatus(latest?.after_json,start,end,throughStableChapterOrder);
      const authorStatus=value(values.status);
      const sources:PayoffLedgerSource[]=[{kind:'card',id:cardId,label:authorStatus==='paid_off'&&!paidOff?'正式伏笔资料（作者标记已回收，但无正式结算）':'正式伏笔资料',chapterOrder:null,versionId:cardVersionId}];
      const actionLabels:Record<string,string>={plant:'埋设',reinforce:'强化',recover:'计划回收',misdirect:'误导',reveal:'揭示'};
      for(const plan of cardPlans)sources.push({kind:'adopted_plan',id:String(plan.id),label:`已采用${plan.plan_title}：${actionLabels[String(plan.action_key)]??'引用'}`,chapterOrder:numeric(plan.logical_order),versionId:String(plan.plan_version_id)});
      for(const placement of cardPlacements)sources.push({kind:'narrative_placement',id:String(placement.id),label:`叙事位置标注：${placement.chapter_title} · ${placement.role}`,chapterOrder:numeric(placement.logical_order),versionId:null});
      for(const change of cardSettlements)sources.push({kind:'settlement',id:String(change.id),label:`第 ${change.logical_order} 章正式结算：${String(change.after_json)}`,chapterOrder:Number(change.logical_order),versionId:String(change.settlement_id)});
      if(manual)sources.push({kind:'manual_window',id:String(manual.id),label:`手工目标窗口 v${manual.version}`,chapterOrder:null,versionId:String(manual.id)});
      return{cardId,cardVersionId,title:String(card.title),summary:value(values.setup_content),authorPlan:value(values.payoff_plan),status,
        targetStartChapterOrder:start,targetEndChapterOrder:end,windowSource:manual?'manual':plannedOrders.length?'adopted_plan':'unknown',windowRevision:Number(manual?.revision??0),settlementUnavailableReason,
        lastTouchedChapterOrder:latest?Number(latest.logical_order):null,paidOffChapterOrder:paidOff?Number(latest.logical_order):null,sources};
    });
    await client.query('COMMIT');
    return{bookId,available:true,windowEditingAvailable:installed,throughStableChapterOrder,
      summary:{pendingCount:items.filter(item=>item.status==='pending'||item.status==='urgent').length,
        urgentCount:items.filter(item=>item.status==='urgent').length,overdueCount:items.filter(item=>item.status==='overdue').length,
        paidOffCount:items.filter(item=>item.status==='paid_off').length,unknownWindowCount:items.filter(item=>item.targetStartChapterOrder===null&&item.targetEndChapterOrder===null).length},items,updatedAt:new Date().toISOString()};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

export async function getPayoffWindowRequest(bookId:string,idempotencyKey:string):Promise<PayoffWindowReceipt|null>{
  const pool=await getNewDesignPool();
  if(!(await windowInstalled(pool)))return null;
  const row=(await pool.query(`SELECT version.*,version.version AS revision FROM new_design.payoff_window_versions version
    WHERE version.book_id=$1 AND version.idempotency_key=$2`,[bookId,idempotencyKey])).rows[0];
  return row?windowReceipt(row):null;
}

export async function savePayoffWindow(bookId:string,cardId:string,input:SavePayoffWindowInput):Promise<PayoffWindowReceipt>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(!(await windowInstalled(client)))throw new NewDesignError('目标窗口功能尚未安装；原伏笔资料和规划未改动。',503);
    assertFound((await client.query(`SELECT card.id FROM new_design.books book
      JOIN new_design.cards card ON card.space_id=book.space_id AND card.id=$2 AND card.status='active'
      JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='foreshadow'
      WHERE book.id=$1 AND book.status='active' FOR UPDATE OF card`,[bookId,cardId])).rows[0],'本书伏笔不存在或已归档。');
    const existing=(await client.query('SELECT * FROM new_design.payoff_window_versions WHERE book_id=$1 AND idempotency_key=$2',[bookId,input.idempotencyKey])).rows[0];
    if(existing){
      if(String(existing.card_id)!==cardId||numeric(existing.start_chapter_order)!==input.startChapterOrder||numeric(existing.end_chapter_order)!==input.endChapterOrder||Number(existing.version)-1!==input.expectedRevision)
        throw new NewDesignError('请求编号已用于不同目标窗口；请核对原回执。',409);
      await client.query('COMMIT');return windowReceipt({...existing,revision:existing.version});
    }
    const pointer=(await client.query('SELECT revision FROM new_design.payoff_windows WHERE book_id=$1 AND card_id=$2 FOR UPDATE',[bookId,cardId])).rows[0];
    const revision=Number(pointer?.revision??0);
    if(revision!==input.expectedRevision)throw new NewDesignError('目标窗口版本已变化，请保留当前输入并重读后核对。',409);
    const id=randomUUID(),version=revision+1;
    const created=(await client.query(`INSERT INTO new_design.payoff_window_versions
      (id,book_id,card_id,version,start_chapter_order,end_chapter_order,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,bookId,cardId,version,input.startChapterOrder,input.endChapterOrder,input.idempotencyKey])).rows[0];
    await client.query(`INSERT INTO new_design.payoff_windows(book_id,card_id,current_version_id,revision)
      VALUES($1,$2,$3,$4) ON CONFLICT(book_id,card_id) DO UPDATE
      SET current_version_id=EXCLUDED.current_version_id,revision=EXCLUDED.revision,updated_at=now()`,[bookId,cardId,id,version]);
    await client.query('COMMIT');return windowReceipt({...created,revision:version});
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);if(missingRelation(error))throw new NewDesignError('目标窗口功能尚未安装；原伏笔资料和规划未改动。',503);throw error;}finally{client.release();}
}
