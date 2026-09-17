import {useEffect,useRef,useState} from 'react';
export function useWorkspaceLocation(request:(action:()=>void)=>void) {
 const [query,setQuery]=useState(()=>new URLSearchParams(location.search)),current=useRef(location.pathname+location.search+location.hash),liveRequest=useRef(request);liveRequest.current=request;
 useEffect(()=>{const pop=()=>{const target=location.pathname+location.search+location.hash;if(target.split('?')[0].split('#')[0]!==current.current.split('?')[0].split('#')[0])return;const previous=current.current;history.replaceState(null,'',previous);liveRequest.current(()=>{history.replaceState(null,'',target);current.current=target;setQuery(new URLSearchParams(location.search));});};window.addEventListener('popstate',pop);window.addEventListener('hashchange',pop);return()=>{window.removeEventListener('popstate',pop);window.removeEventListener('hashchange',pop);};},[]);
 const commit=(patch:Record<string,string|null>,replace=false)=>{const next=new URLSearchParams(location.search);for(const [key,value]of Object.entries(patch)){if(value===null||value==='')next.delete(key);else next.set(key,value);}const target=location.pathname+(next.size?`?${next}`:'');if(replace)history.replaceState(null,'',target);else history.pushState(null,'',target);current.current=target;setQuery(next);};
 const update=(patch:Record<string,string|null>,action?:()=>void)=>request(()=>{commit(patch);action?.();});
 return {query,update,commit};
}
