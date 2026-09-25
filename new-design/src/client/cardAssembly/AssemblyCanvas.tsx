import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {Graph,Node,Edge} from '@antv/x6';
import {Selection} from '@antv/x6-plugin-selection';
import {Transform} from '@antv/x6-plugin-transform';
import {Snapline} from '@antv/x6-plugin-snapline';
import './assembly.css';

export interface CanvasNode {id:string;title:string;kind:'root'|'module'|'meta'|'preview';detail?:string;x:number;y:number;width:number;height:number;parentId?:string;required?:boolean;collapsed?:boolean;expandedWidth?:number;expandedHeight?:number;sourceVersionId?:string}
export interface CanvasEdge {id:string;from:string;to:string;label:string;relationTypeVersionId?:string;kind:'membership'|'card_relation';required?:boolean}
export interface CanvasSnapshot {nodes:CanvasNode[];edges:CanvasEdge[]}
export interface CanvasHandle {
  snapshot():CanvasSnapshot;
  addNode(node:CanvasNode):void;
  setNode(id:string,patch:Partial<CanvasNode>):void;
  setEdge(id:string,patch:Partial<CanvasEdge>):void;
  removeSelected():void;
  copySelected(withChildren:boolean):void;
  collapseSelected():void;
  autoLayout():void;
  zoom(value:number):void;
  fit():void;
}

function nodeAttrs(node:CanvasNode){const group=node.kind==='module';return{
  body:{fill:group?'#f3f0fb':node.kind==='root'?'#fff9eb':'#fff',stroke:group?'#9787bd':node.kind==='root'?'#bc913e':'#b8c5d1',strokeWidth:1.5,rx:10,ry:10,strokeDasharray:group?'5 4':''},
  title:{text:node.title,refX:14,refY:18,fontSize:13,fontWeight:700,fill:'#172b40',textAnchor:'start',textVerticalAnchor:'middle',textWrap:{width:-28,height:20,ellipsis:true}},
  detail:{text:node.detail??(group?'组合模块':node.kind==='root'?'书籍根卡':'元卡片'),refX:14,refY:45,fontSize:11,fill:'#60778d',textAnchor:'start',textVerticalAnchor:'middle',textWrap:{width:-28,height:30,ellipsis:true}},
  badge:{text:node.kind==='root'?'本书':group?'模块':node.required?'必选':'可选',refX:14,refY:node.height-16,fontSize:10,fill:node.required?'#13836f':'#698398',textAnchor:'start',textVerticalAnchor:'middle'},
}}
function portGroups(){const attrs={circle:{r:4,magnet:true,stroke:'#629ac4',strokeWidth:1.5,fill:'#fff'}};return{
  top:{position:'top' as const,attrs},right:{position:'right' as const,attrs},bottom:{position:'bottom' as const,attrs},left:{position:'left' as const,attrs},
}}
const ports={groups:portGroups(),items:['top','right','bottom','left'].map(group=>({id:group,group}))};

export const AssemblyCanvas=forwardRef<CanvasHandle,{initial:CanvasSnapshot;onSelect:(value:{type:'node'|'edge'|null;id:string|null})=>void;rootId?:string;uniqueModuleRefs?:boolean}>(({initial,onSelect,rootId,uniqueModuleRefs},ref)=>{
  const host=useRef<HTMLDivElement>(null),graphRef=useRef<Graph|null>(null),selected=useRef<string|null>(null);
  const [zoomLabel,setZoomLabel]=useState(100),[menu,setMenu]=useState<{x:number;y:number}|null>(null),[hand,setHand]=useState(false);
  const callbacks=useRef({onSelect,rootId,uniqueModuleRefs});callbacks.current={onSelect,rootId,uniqueModuleRefs};
  function graph(){if(!graphRef.current)throw new Error('画布尚未准备完成。');return graphRef.current}
  function makeNode(item:CanvasNode):Node{return graph().addNode({id:item.id,shape:'rect',x:item.x,y:item.y,width:item.width,height:item.height,markup:[{tagName:'rect',selector:'body'},{tagName:'text',selector:'title'},{tagName:'text',selector:'detail'},{tagName:'text',selector:'badge'}],attrs:nodeAttrs(item),...(item.kind==='preview'?{}:{ports}),data:{...item}})}
  function makeEdge(item:CanvasEdge):Edge{return graph().addEdge({id:item.id,source:{cell:item.from},target:{cell:item.to},router:{name:'manhattan'},connector:{name:'rounded'},attrs:{line:{stroke:item.kind==='membership'?'#be9654':'#5f91ba',strokeWidth:1.8,targetMarker:{name:'classic',size:6}}},labels:[{attrs:{label:{text:item.label,fill:'#314f67',fontSize:11},body:{fill:'#fff',stroke:'#d3dde5'}}}],data:{...item}})}
  function snapshot():CanvasSnapshot{const g=graph();return{
    nodes:g.getNodes().map(node=>{const data=node.getData<CanvasNode>(),p=node.getPosition(),s=node.getSize();return{...data,id:node.id,x:p.x,y:p.y,width:s.width,height:s.height,parentId:node.getParent()?.id}}),
    edges:g.getEdges().filter(edge=>edge.getSourceCellId()&&edge.getTargetCellId()).map(edge=>{const data=edge.getData<CanvasEdge>()??{} as CanvasEdge;return{...data,id:edge.id,from:edge.getSourceCellId()!,to:edge.getTargetCellId()!,label:edge.getLabels()?.[0]?.attrs?.label?.text?.toString()??data.label??'选择关系',kind:data.kind??'card_relation'}}),
  }}
  function choose(cell:Node|Edge|null){selected.current=cell?.id??null;callbacks.current.onSelect({type:cell?cell.isNode()?'node':'edge':null,id:cell?.id??null});setMenu(null)}
  function removeSelected(){const id=selected.current;if(!id||id===callbacks.current.rootId)return;const g=graph(),cell=g.getCellById(id);if(!cell||cell.isNode()&&cell.getData<CanvasNode>()?.kind==='preview')return;if(cell.isNode()&&cell.getChildren()?.length&&!window.confirm('删除这个组及其子卡片和相关连线？'))return;g.removeCell(cell);choose(null)}
  function copySelected(withChildren:boolean){const id=selected.current;if(!id||id===callbacks.current.rootId)return;const g=graph(),source=g.getCellById(id);if(!source?.isNode())return;
    const original=source as Node,data=original.getData<CanvasNode>();if(data.kind==='preview'||callbacks.current.uniqueModuleRefs&&data.kind==='module')return;
    const items=[original,...(withChildren?(original.getChildren()??[]).filter((cell):cell is Node=>cell.isNode()):[])],map=new Map<string,string>();
    for(const item of items)map.set(item.id,crypto.randomUUID());
    for(const item of items){const prior=item.getData<CanvasNode>(),p=item.getPosition(),s=item.getSize(),copy=makeNode({...prior,id:map.get(item.id)!,title:item===original?`${prior.title} 副本`:prior.title,x:p.x+36,y:p.y+36,width:s.width,height:s.height,parentId:prior.parentId&&map.has(prior.parentId)?map.get(prior.parentId):prior.parentId});const parent=copy.getData<CanvasNode>().parentId;if(parent)g.getCellById(parent)?.embed(copy)}
    for(const edge of g.getEdges().slice()){const from=edge.getSourceCellId(),to=edge.getTargetCellId();if(from&&to&&map.has(from)&&map.has(to)){const prior=edge.getData<CanvasEdge>();makeEdge({...prior,id:crypto.randomUUID(),from:map.get(from)!,to:map.get(to)!})}}
    choose(g.getCellById(map.get(id)!) as Node);
  }
  function collapseSelected(){const id=selected.current,cell=id?graph().getCellById(id):null;if(!cell?.isNode()||!cell.getChildren()?.length)return;const node=cell as Node,data=node.getData<CanvasNode>(),collapsed=!data.collapsed;
    if(collapsed){const size=node.getSize();node.setData({...data,collapsed:true,expandedWidth:size.width,expandedHeight:size.height});node.getChildren()?.forEach(child=>child.hide());node.resize(240,74)}
    else{node.getChildren()?.forEach(child=>child.show());node.resize(data.expandedWidth??500,data.expandedHeight??250);node.setData({...data,collapsed:false})}
  }
  function autoLayout(){const g=graph();let x=50,y=90,rowHeight=0;const width=Math.max(680,host.current?.clientWidth??900)-100;
    for(const node of g.getNodes().filter(item=>!item.getParent())){const size=node.getSize();if(x+size.width>width&&x>50){x=50;y+=rowHeight+80;rowHeight=0}node.position(x,y);x+=size.width+70;rowHeight=Math.max(rowHeight,size.height)}g.zoomToFit({padding:55,maxScale:1});setZoomLabel(Math.round(g.zoom()*100))}
  function zoom(value:number){const g=graph(),next=Math.max(.45,Math.min(2,value));g.zoom(next);setZoomLabel(Math.round(next*100))}
  useImperativeHandle(ref,()=>({snapshot,addNode(item){const node=makeNode(item);if(item.parentId)graph().getCellById(item.parentId)?.embed(node);choose(node)},setNode(id,patch){const node=graph().getCellById(id);if(!node?.isNode())return;const next={...node.getData<CanvasNode>(),...patch};node.setData(next);node.setAttrs(nodeAttrs(next));if(patch.width||patch.height)node.resize(next.width,next.height)},setEdge(id,patch){const edge=graph().getCellById(id);if(!edge?.isEdge())return;const next={...edge.getData<CanvasEdge>(),...patch};edge.setData(next);edge.setLabels([{attrs:{label:{text:next.label,fill:'#314f67',fontSize:11},body:{fill:'#fff',stroke:'#d3dde5'}}}])},removeSelected,copySelected,collapseSelected,autoLayout,zoom,fit(){graph().zoomToFit({padding:55,minScale:.45,maxScale:2});setZoomLabel(Math.round(graph().zoom()*100))}}));
  useEffect(()=>{if(!host.current)return;const g=new Graph({container:host.current,background:{color:'#f6f9fc'},grid:{size:20,visible:true,type:'dot',args:{color:'#d9e3ec',thickness:1}},panning:{enabled:true,eventTypes:['leftMouseDown']},mousewheel:{enabled:true,modifiers:['ctrl'],minScale:.45,maxScale:2},interacting:{nodeMovable:view=>view.cell.getData<CanvasNode>()?.kind!=='preview'},connecting:{allowBlank:false,allowLoop:false,allowNode:false,allowPort:true,snap:true,router:'manhattan',connector:'rounded',createEdge(){return new Edge({router:{name:'manhattan'},connector:{name:'rounded'},attrs:{line:{stroke:'#5f91ba',strokeWidth:1.8,targetMarker:{name:'classic',size:6}}}})}},embedding:{enabled:false}});
    const groupMinimum=(node:Node,axis:'width'|'height')=>{const children=node.getChildren()?.filter((cell):cell is Node=>cell.isNode())??[];if(!children.length||node.getData<CanvasNode>()?.collapsed)return axis==='width'?160:72;const origin=node.getPosition();return Math.max(axis==='width'?160:72,...children.map(child=>{const position=child.getPosition(),size=child.getSize();return(axis==='width'?position.x+size.width-origin.x:position.y+size.height-origin.y)+20}))};
    graphRef.current=g;g.disablePanning();g.use(new Selection({enabled:true,multiple:true,rubberband:true,showNodeSelectionBox:true}));g.use(new Transform({resizing:{enabled:node=>node.getData<CanvasNode>()?.kind!=='preview',minWidth:node=>groupMinimum(node,'width'),minHeight:node=>groupMinimum(node,'height')},rotating:false}));g.use(new Snapline({enabled:true,sharp:true}));
    initial.nodes.filter(item=>!item.parentId).forEach(makeNode);initial.nodes.filter(item=>item.parentId).forEach(item=>{const node=makeNode(item);g.getCellById(item.parentId!)?.embed(node)});initial.edges.forEach(makeEdge);
    initial.nodes.filter(item=>item.collapsed).forEach(item=>g.getCellById(item.id)?.getChildren()?.forEach(child=>child.hide()));
    g.on('node:click',({node})=>choose(node));g.on('edge:click',({edge})=>choose(edge));g.on('blank:click',()=>choose(null));
    g.on('edge:connected',({edge})=>{if(!edge.getSourceCellId()||!edge.getTargetCellId())return;if(!edge.getData<CanvasEdge>()?.kind){edge.setData({kind:'card_relation',label:'选择关系'});edge.setLabels([{attrs:{label:{text:'选择关系'}}}])}choose(edge)});
    g.on('node:contextmenu',({node,e})=>{e.preventDefault();choose(node);const rect=host.current!.getBoundingClientRect();setMenu({x:e.clientX-rect.left,y:e.clientY-rect.top})});
    g.on('edge:contextmenu',({edge,e})=>{e.preventDefault();choose(edge);const rect=host.current!.getBoundingClientRect();setMenu({x:e.clientX-rect.left,y:e.clientY-rect.top})});
    g.on('scale',()=>setZoomLabel(Math.round(g.zoom()*100)));
    const resize=new ResizeObserver(()=>g.resize(host.current!.clientWidth,host.current!.clientHeight));resize.observe(host.current);return()=>{resize.disconnect();g.dispose();graphRef.current=null};
  },[]);
  return <div className="nd-assembly-canvas-wrap"><div className="nd-assembly-canvas-tools" role="toolbar" aria-label="画布工具"><button type="button" className={!hand?'active':''} onClick={()=>{setHand(false);graph().disablePanning()}}>选择</button><button type="button" className={hand?'active':''} onClick={()=>{setHand(true);graph().enablePanning()}}>手型</button><button type="button" onClick={autoLayout}>自动布局</button><button type="button" onClick={()=>copySelected(false)}>复制</button><button type="button" onClick={()=>copySelected(true)}>复制组</button><button type="button" onClick={collapseSelected}>收起 / 展开</button><button type="button" onClick={removeSelected}>删除</button><span className="spacer"/><button type="button" onClick={()=>zoom(graph().zoom()-.1)}>−</button><span>{zoomLabel}%</span><button type="button" onClick={()=>zoom(graph().zoom()+.1)}>＋</button><button type="button" onClick={()=>zoom(1)}>100%</button><button type="button" onClick={()=>{graph().zoomToFit({padding:55,minScale:.45,maxScale:2});setZoomLabel(Math.round(graph().zoom()*100))}}>适应画布</button></div><div ref={host} className="nd-assembly-canvas" aria-label="AntV X6 卡片编排画布"/>{menu&&<div className="nd-assembly-context" style={{left:menu.x,top:menu.y}} role="menu"><button type="button" onClick={()=>{copySelected(false);setMenu(null)}}>复制节点</button><button type="button" onClick={()=>{copySelected(true);setMenu(null)}}>复制节点与子节点</button><button type="button" onClick={()=>{collapseSelected();setMenu(null)}}>收起 / 展开组</button><button type="button" onClick={()=>{removeSelected();setMenu(null)}}>删除选中项</button></div>}</div>;
});
AssemblyCanvas.displayName='AssemblyCanvas';
