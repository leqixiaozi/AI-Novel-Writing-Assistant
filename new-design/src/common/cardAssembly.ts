import type {FieldDefinition} from './contracts';

export interface AssemblyIssue {code:string;path:string;message:string}
export interface MetaCardDefinition {id:string;key:string;name:string;description:string;category:string;kind:'book_root'|'ordinary';fields:FieldDefinition[];revision:number;currentVersionId:string|null;status:'draft'|'published'}
export interface MetaCardVersion {id:string;metaId:string;version:number;fields:FieldDefinition[];cardTypeId:string;cardTypeVersionId:string;contentHash:string}
export interface CardTemplateDefinition {id:string;key:string;name:string;description:string;category:string;graph:CardTemplateGraph;revision:number;currentVersionId:string|null;status:'draft'|'published'}
export interface CardTemplateVersion {id:string;templateId:string;version:number;graph:CardTemplateGraph;contentHash:string}
export interface MetaSlot {id:string;metaVersionId:string;required:boolean;x?:number;y?:number;width?:number;height?:number}
export interface AssemblyEdge {id:string;kind:"membership"|"card_relation";from:string;to:string;relationTypeVersionId?:string;required?:boolean;label?:string}
export interface CardTemplateGraph {slots:MetaSlot[];edges:AssemblyEdge[];frame?:{x:number;y:number;width:number;height:number;collapsed?:boolean}}
export interface ModuleReference {id:string;cardTemplateId:string;cardTemplateVersionId:string;initialInstanceCount:number;x?:number;y?:number;width?:number;height?:number;collapsed?:boolean}
export interface BookAssembly {root:{id:string;metaVersionId:string;x?:number;y?:number;width?:number;height?:number};modules:ModuleReference[];standalone:MetaSlot[];edges:AssemblyEdge[]}
export interface BookTemplateDefinition {id:string;key:string;name:string;description:string;assembly:BookAssembly;revision:number;currentVersionId:string|null;status:'draft'|'published'}
export interface BookAssemblyWorkspace {
  bookId:string;legacy:boolean;bookName:string;bookRevision?:number;templateVersionId?:string;
  root:{id:string;nodeId:string;title:string;revision:number;values:Record<string,unknown>;metaVersionId:string|null;fields:FieldDefinition[]}|null;
  modules:Array<{id:string;moduleRefNodeId:string;ordinal:number;sourceCardTemplateVersionId:string;displayName:string;complete:boolean;pendingRequiredSlots:number;pendingRequiredRelations:number}>;
  slots:Array<{id:string;nodeId:string;moduleInstanceId:string|null;sourceNodeId:string;metaVersionId:string;name:string;cardTitle?:string;required:boolean;status:'pending'|'filled';cardId:string|null;revision:number;fields:FieldDefinition[]}>;
  relations:Array<{id:string;fromNodeId:string;toNodeId:string;moduleInstanceId:string|null;sourceEdgeId:string;relationTypeVersionId:string;name:string;fields:FieldDefinition[];status:'pending'|'confirmed'|'invalidated';required:boolean;revision:number;relationId:string|null}>;
  availableRelationTypes?:Array<{id:string;name:string;direction:string;fields:FieldDefinition[];sourceTypeKeys:string[];targetTypeKeys:string[]}>;
  instanceRelations?:Array<{id:string;fromSlotId:string;toSlotId:string;name:string;properties:Record<string,unknown>}>;
  moduleReferences?:Array<ModuleReference&{name:string}>;
}
export interface ModuleInstance {id:string;moduleRefNodeId:string;sourceCardTemplateVersionId:string;ordinal:number;slots:Array<{id:string;nodeId:string;moduleInstanceId:string;sourceSlotId:string;metaVersionId:string;required:boolean}>;edges:Array<{id:string;sourceEdgeId:string;moduleInstanceId:string;fromNodeId:string;toNodeId:string;relationTypeVersionId?:string;required?:boolean;label?:string}>}

function issue(code:string,path:string,message:string):AssemblyIssue{return{code,path,message}}
function duplicateIds(ids:string[],path:string):AssemblyIssue[]{const seen=new Set<string>(),issues:AssemblyIssue[]=[];ids.forEach((id,index)=>{if(!id||seen.has(id))issues.push(issue("duplicate_id",`${path}.${index}`,"节点或连线身份为空或重复。"));seen.add(id)});return issues}

export function validateCardTemplateGraph(graph:CardTemplateGraph,metaVersions:Set<string>,relationVersions:Set<string>):AssemblyIssue[]{
  const issues=[...duplicateIds(graph.slots.map(slot=>slot.id),"slots"),...duplicateIds(graph.edges.map(edge=>edge.id),"edges")];
  if(!graph.slots.length)issues.push(issue("empty_template","slots","卡片模板至少需要一张元卡片。"));
  const slotIds=new Set(graph.slots.map(slot=>slot.id));
  graph.slots.forEach((slot,index)=>{if(!metaVersions.has(slot.metaVersionId))issues.push(issue("missing_meta_version",`slots.${index}.metaVersionId`,"元卡片发布版本不存在。"))});
  graph.edges.forEach((edge,index)=>{
    if(!slotIds.has(edge.from)||!slotIds.has(edge.to))issues.push(issue("missing_endpoint",`edges.${index}`,"连线两端必须属于当前模板。"));
    if(edge.from===edge.to)issues.push(issue("self_relation",`edges.${index}`,"卡片不能与自己建立关系。"));
    if(edge.kind!=="card_relation")issues.push(issue("invalid_template_edge",`edges.${index}`,"卡片模板组内连线必须是明确的资料关系。"));
    if(edge.kind==="card_relation"&&(!edge.relationTypeVersionId||!relationVersions.has(edge.relationTypeVersionId)))issues.push(issue("missing_relation_version",`edges.${index}.relationTypeVersionId`,"资料关系必须选择已发布关系类型版本。"));
  });
  return issues;
}

export function validateBookAssembly(assembly:BookAssembly,cardTemplateVersions:Set<string>,metaVersions:Set<string>,relationVersions?:Set<string>):AssemblyIssue[]{
  const issues:AssemblyIssue[]=[];
  if(!assembly.root?.id||!metaVersions.has(assembly.root.metaVersionId))issues.push(issue("invalid_root","root","书籍根节点必须引用已发布的书籍信息元卡片。"));
  const moduleDefinitions=new Set<string>();
  assembly.modules.forEach((module,index)=>{
    if(moduleDefinitions.has(module.cardTemplateId))issues.push(issue("duplicate_module_reference",`modules.${index}`,"同一卡片模板在书籍模板中只引用一次；更多人物在本书中创建。"));
    moduleDefinitions.add(module.cardTemplateId);
    if(!cardTemplateVersions.has(module.cardTemplateVersionId))issues.push(issue("missing_card_template_version",`modules.${index}.cardTemplateVersionId`,"卡片模板版本不存在。"));
    if(!Number.isSafeInteger(module.initialInstanceCount)||module.initialInstanceCount<0)issues.push(issue("invalid_initial_count",`modules.${index}.initialInstanceCount`,"初始实例数量必须为非负整数。"));
  });
  assembly.standalone.forEach((slot,index)=>{if(!metaVersions.has(slot.metaVersionId))issues.push(issue("missing_meta_version",`standalone.${index}.metaVersionId`,"元卡片发布版本不存在。"))});
  const ids=[assembly.root?.id,...assembly.modules.map(module=>module.id),...assembly.standalone.map(slot=>slot.id)].filter((id):id is string=>typeof id==="string");
  issues.push(...duplicateIds(ids,"nodes"),...duplicateIds(assembly.edges.map(edge=>edge.id),"edges"));
  const nodeIds=new Set(ids);
  const moduleIds=new Set(assembly.modules.map(module=>module.id));
  assembly.edges.forEach((edge,index)=>{
    if(!nodeIds.has(edge.from)||!nodeIds.has(edge.to))issues.push(issue("missing_endpoint",`edges.${index}`,"书籍模板连线端点不存在。"));
    if(edge.from===edge.to)issues.push(issue("self_relation",`edges.${index}`,"节点不能连接自己。"));
    if(edge.kind==='membership'&&(edge.from!==assembly.root.id||edge.to===assembly.root.id))issues.push(issue("invalid_membership",`edges.${index}`,"拥有／归属线只能从书籍根卡指向一个模块或独立元卡片。"));
    if(edge.kind==='card_relation'&&relationVersions&&(!edge.relationTypeVersionId||!relationVersions.has(edge.relationTypeVersionId)))issues.push(issue("missing_relation_version",`edges.${index}`,"资料关系必须选择已发布关系类型版本。"));
    if(edge.kind==='card_relation'&&(moduleIds.has(edge.from)||moduleIds.has(edge.to)))issues.push(issue("ambiguous_module_relation",`edges.${index}`,"模块引用还不是具体人物；跨模块资料关系须在本书实例之间建立。"));
  });
  for(const [index,node] of [...assembly.modules,...assembly.standalone].entries()){
    const memberships=assembly.edges.filter(edge=>edge.kind==='membership'&&edge.to===node.id);
    if(memberships.length!==1||memberships[0].from!==assembly.root.id)issues.push(issue("missing_membership",`nodes.${index}`,"每个模块或独立元卡片须由书籍根卡的一条拥有／归属线连接。"));
  }
  return issues;
}

export function instantiateModule(source:ModuleReference,graph:CardTemplateGraph,ordinal:number,newId:()=>string):ModuleInstance{
  if(!Number.isSafeInteger(ordinal)||ordinal<1)throw new Error("模块实例序号必须从 1 开始。");
  const id=newId(),nodeBySlot=new Map<string,string>();
  const slots=graph.slots.map(slot=>{const nodeId=newId();nodeBySlot.set(slot.id,nodeId);return{id:newId(),nodeId,moduleInstanceId:id,sourceSlotId:slot.id,metaVersionId:slot.metaVersionId,required:slot.required}});
  const edges=graph.edges.filter(edge=>edge.kind==="card_relation").map(edge=>{
    const fromNodeId=nodeBySlot.get(edge.from),toNodeId=nodeBySlot.get(edge.to);
    if(!fromNodeId||!toNodeId)throw new Error("卡片模板内部关系端点不存在。");
    return{id:newId(),sourceEdgeId:edge.id,moduleInstanceId:id,fromNodeId,toNodeId,relationTypeVersionId:edge.relationTypeVersionId,required:edge.required,label:edge.label};
  });
  return{id,moduleRefNodeId:source.id,sourceCardTemplateVersionId:source.cardTemplateVersionId,ordinal,slots,edges};
}

export function planBookInstances(modules:ModuleReference[],graphs:Record<string,CardTemplateGraph>,newId:()=>string):ModuleInstance[]{
  return modules.flatMap(module=>{
    const graph=graphs[module.cardTemplateVersionId];
    if(!graph)throw new Error('卡片模板冻结图不存在。');
    return Array.from({length:module.initialInstanceCount},(_,index)=>instantiateModule(module,graph,index+1,newId));
  });
}
