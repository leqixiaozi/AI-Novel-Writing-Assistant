const test=require('node:test');
const assert=require('node:assert/strict');
const {compiled}=require('./support/isolatedDatabase.cjs');
const {validateCardTemplateGraph,validateBookAssembly,instantiateModule,planBookInstances}=compiled('common/cardAssembly');

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const person={
  slots:[{id:id(1),metaVersionId:id(11),required:true},{id:id(2),metaVersionId:id(12),required:true}],
  edges:[{id:id(3),kind:'card_relation',from:id(2),to:id(1),relationTypeVersionId:id(13),required:true,label:'归属人物'}],
};

test('人物模板保留两张独立元卡片和明确的战力归属边',()=>{
  assert.deepEqual(validateCardTemplateGraph(person,new Set([id(11),id(12)]),new Set([id(13)])),[]);
  assert.equal(validateCardTemplateGraph({...person,edges:[{...person.edges[0],to:id(99)}]},new Set([id(11),id(12)]),new Set([id(13)])).some(issue=>issue.code==='missing_endpoint'),true);
});

test('模板内部连线不能伪装为归属线而在实例化时消失',()=>{
  const invalid={...person,edges:[{...person.edges[0],kind:'membership'}]};
  assert.equal(validateCardTemplateGraph(invalid,new Set([id(11),id(12)]),new Set([id(13)])).some(issue=>issue.code==='invalid_template_edge'),true);
});

test('一本书对人物模板只能保留一次模块引用',()=>{
  const module={id:id(4),cardTemplateId:id(14),cardTemplateVersionId:id(15),initialInstanceCount:1};
  const assembly={root:{id:id(5),metaVersionId:id(16)},modules:[module,{...module,id:id(6)}],standalone:[],edges:[]};
  assert.equal(validateBookAssembly(assembly,new Set([id(15)]),new Set([id(16)])).some(issue=>issue.code==='duplicate_module_reference'),true);
});

test('书籍模板中的模块必须由书籍根卡明确拥有',()=>{
  const module={id:id(4),cardTemplateId:id(14),cardTemplateVersionId:id(15),initialInstanceCount:0};
  const assembly={root:{id:id(5),metaVersionId:id(16)},modules:[module],standalone:[],edges:[]};
  assert.equal(validateBookAssembly(assembly,new Set([id(15)]),new Set([id(16)])).some(issue=>issue.code==='missing_membership'),true);
  assembly.edges.push({id:id(7),kind:'membership',from:id(5),to:id(4),label:'拥有'});
  assert.equal(validateBookAssembly(assembly,new Set([id(15)]),new Set([id(16)])).length,0);
});

test('书籍根卡只能向模块或独立元卡片发出归属线',()=>{
  const assembly={root:{id:id(5),metaVersionId:id(16)},modules:[],standalone:[],edges:[{id:id(7),kind:'membership',from:id(5),to:id(5)}]};
  assert.equal(validateBookAssembly(assembly,new Set(),new Set([id(16)])).some(issue=>issue.code==='invalid_membership'),true);
});

test('模块引用之间的资料关系须等本书实例建立后再连接',()=>{
  const module={id:id(4),cardTemplateId:id(14),cardTemplateVersionId:id(15),initialInstanceCount:2};
  const assembly={root:{id:id(5),metaVersionId:id(16)},modules:[module],standalone:[],edges:[
    {id:id(7),kind:'membership',from:id(5),to:id(4)},
    {id:id(8),kind:'card_relation',from:id(5),to:id(4),relationTypeVersionId:id(13)},
  ]};
  assert.equal(validateBookAssembly(assembly,new Set([id(15)]),new Set([id(16)]),new Set([id(13)])).some(issue=>issue.code==='ambiguous_module_relation'),true);
});

test('同一人物模块创建两个人物时槽位与内部边均不共用身份',()=>{
  let sequence=100;const next=()=>id(++sequence);
  const source={id:id(4),cardTemplateId:id(14),cardTemplateVersionId:id(15),initialInstanceCount:1};
  const first=instantiateModule(source,person,1,next),second=instantiateModule(source,person,2,next);
  assert.equal(first.slots.length,2);assert.equal(second.slots.length,2);
  assert.notEqual(first.id,second.id);
  assert.equal(new Set([...first.slots,...second.slots].map(slot=>slot.id)).size,4);
  assert.notEqual(first.edges[0].id,second.edges[0].id);
  assert.equal(first.edges[0].sourceEdgeId,second.edges[0].sourceEdgeId);
  assert.equal(first.edges[0].fromNodeId,first.slots[1].nodeId);
  assert.equal(second.edges[0].toNodeId,second.slots[0].nodeId);
});

test('初始实例数只决定开书预建数量，零个时不产生空人物',()=>{
  let sequence=200;const next=()=>id(++sequence);
  const module={id:id(4),cardTemplateId:id(14),cardTemplateVersionId:id(15),initialInstanceCount:0};
  assert.equal(planBookInstances([module],{[id(15)]:person},next).length,0);
  const built=planBookInstances([{...module,initialInstanceCount:2}],{[id(15)]:person},next);
  assert.deepEqual(built.map(value=>value.ordinal),[1,2]);
  assert.equal(new Set(built.flatMap(value=>value.slots.map(slot=>slot.nodeId))).size,4);
});
