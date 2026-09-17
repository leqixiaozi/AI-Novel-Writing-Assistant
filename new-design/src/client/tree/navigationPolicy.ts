export interface NavigationBranch {id:string;name:string;description?:string;searchText?:string;children?:NavigationBranch[];}

export function filterNavigation<T extends NavigationBranch>(nodes:T[],query:string):T[]{
 const term=query.trim().toLocaleLowerCase("zh-CN");if(!term)return nodes;
 return nodes.flatMap(node=>{if(`${node.name} ${node.description??""} ${node.searchText??""}`.toLocaleLowerCase("zh-CN").includes(term))return [node];const children=filterNavigation(node.children??[],query);return children.length?[{...node,children} as T]:[];});
}
export function navigationAncestors(nodes:NavigationBranch[],selected:Set<string>):string[]{
 const found=new Set<string>();
 const visit=(items:NavigationBranch[],parents:string[])=>{for(const item of items){if(selected.has(item.id))for(const id of parents)found.add(id);visit(item.children??[],[...parents,item.id]);}};
 visit(nodes,[]);return [...found];
}
export function flatNavigation<T extends {id:string;parentId:string|null;sortOrder?:number} ,R extends NavigationBranch>(items:T[],make:(item:T)=>R,compare?:(a:T,b:T)=>number):R[]{
 const ids=new Set(items.map(item=>item.id)),emitted=new Set<string>();
 const walk=(item:T,path:Set<string>):R|null=>{if(path.has(item.id)||emitted.has(item.id))return null;emitted.add(item.id);const next=new Set([...path,item.id]);const children=ordered.filter(child=>child.parentId===item.id).flatMap(child=>{const node=walk(child,next);return node?[node]:[];});return {...make(item),...(children.length?{children}: {})};};
 const ordered=[...items].sort(compare??((a,b)=>(a.sortOrder??0)-(b.sortOrder??0)||a.id.localeCompare(b.id)));
 const roots=ordered.filter(item=>!item.parentId||!ids.has(item.parentId)).flatMap(item=>{const node=walk(item,new Set());return node?[node]:[];});
 // A malformed cycle must not freeze the UI or silently make a source disappear.
 for(const item of ordered)if(!emitted.has(item.id)){const node=walk(item,new Set());if(node)roots.push(node);}
 return roots;
}
