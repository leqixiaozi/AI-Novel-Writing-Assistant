import type {PublishedWorldPackage} from '../../common/worldPackages';

export interface WorldCatalogEntry {
 rootCardId:string;
 title:string;
 latest:PublishedWorldPackage;
 versions:PublishedWorldPackage[];
}

export function buildWorldCatalog(packages:PublishedWorldPackage[]):WorldCatalogEntry[]{
 const grouped=new Map<string,PublishedWorldPackage[]>();
 for(const item of packages)grouped.set(item.rootCardId,[...(grouped.get(item.rootCardId)??[]),item]);
 return [...grouped].map(([rootCardId,versions])=>{
  versions.sort((left,right)=>right.version-left.version||right.createdAt.localeCompare(left.createdAt));
  const latest=versions[0];
  const root=latest.frame.cards.find(card=>card.cardId===rootCardId);
  return {rootCardId,title:root?.title??'世界根资料待核对',latest,versions};
 }).sort((left,right)=>right.latest.createdAt.localeCompare(left.latest.createdAt)||left.rootCardId.localeCompare(right.rootCardId));
}

export function resolveWorldCatalogVersion(entries:WorldCatalogEntry[],requested:string|null):PublishedWorldPackage|null{
 if(requested)return entries.flatMap(entry=>entry.versions).find(item=>item.id===requested)??null;
 return entries[0]?.latest??null;
}

export function bookWorldRoots<T extends {id:string;title:string;typeKey:string;status:string}>(cards:T[]):T[]{
 return cards.filter(card=>card.status==='active'&&['world_setting','world_overview'].includes(card.typeKey));
}

export function worldImportRoute(bookId:string,packageId:string,rootCardId:string|null):string{
 const base=`/new-design/books/${encodeURIComponent(bookId)}/story-setting?tab=world`;
 return rootCardId?`${base}&selected=${encodeURIComponent(rootCardId)}&detail=sync&source=import&worldPackage=${encodeURIComponent(packageId)}`
  :`${base}&new=1&source=import&worldPackage=${encodeURIComponent(packageId)}`;
}

export function worldPublishRoute(bookId:string,rootCardId:string|null):string{
 const base=`/new-design/books/${encodeURIComponent(bookId)}/story-setting?tab=world`;
 return rootCardId?`${base}&selected=${encodeURIComponent(rootCardId)}&detail=sync`:`${base}&new=1`;
}

export function worldPackageDeepLink(search:string):{kind:'none'}|{kind:'invalid'}|{kind:'selected';packageId:string}{
 const values=new URLSearchParams(search).getAll('worldPackage');
 if(!values.length)return {kind:'none'};
 if(values.length!==1||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values[0]))return {kind:'invalid'};
 return {kind:'selected',packageId:values[0]};
}
