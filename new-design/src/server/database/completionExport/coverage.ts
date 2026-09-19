export interface PlannedContentRow {
  id:string;
  level:'volume'|'chapter';
  cardId:string;
  title:string;
  parentId:string|null;
  adoptedVersionId:string|null;
  documentId:string|null;
  adoptedBodyVersionId:string|null;
  childCount:number;
}

export interface PlannedContentIssue {
  kind:'chapter_plan_unadopted'|'chapter_body_missing'|'chapter_body_unadopted'|'volume_chapters_missing';
  id:string;
  cardId:string;
  title:string;
  parentId:string|null;
}

export function missingPlannedContent(rows:PlannedContentRow[]):PlannedContentIssue[]{
  const issues:PlannedContentIssue[]=[];
  for(const row of rows){
    const kind=row.level==='chapter'
      ? !row.adoptedVersionId?'chapter_plan_unadopted':!row.documentId?'chapter_body_missing':!row.adoptedBodyVersionId?'chapter_body_unadopted':null
      : row.adoptedVersionId&&row.childCount===0?'volume_chapters_missing':null;
    if(kind)issues.push({kind,id:row.id,cardId:row.cardId,title:row.title,parentId:row.parentId});
  }
  return issues;
}

export function plannedBlockerAffectsRange(sourceKind:string,sourceId:string|null,rows:PlannedContentRow[],rangeKind:'book'|'volume'|'chapters',selectedCardIds:Set<string>,volumeId:string|null):boolean{
  if(sourceKind!=='planning_chapter'&&sourceKind!=='planning_volume')return true;
  if(rangeKind==='book')return true;
  const plan=rows.find(row=>row.id===sourceId);
  if(!plan)return true;
  if(rangeKind==='volume')return sourceKind==='planning_volume'?plan.id===volumeId:plan.parentId===volumeId;
  return sourceKind==='planning_chapter'&&selectedCardIds.has(plan.cardId);
}
