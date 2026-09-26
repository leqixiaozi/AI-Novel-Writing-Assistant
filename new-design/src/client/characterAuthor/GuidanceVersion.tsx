import {useEffect,useState} from 'react';
import type {CardVersion} from '../../common/contracts';
import {newDesignApi} from '../api';
/** Read the selected original version only; never redirect to the current editable card. */
export default function GuidanceVersion({cardId,versionId}:{cardId:string;versionId:string}){
 const [version,setVersion]=useState<CardVersion|null>(null),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;setVersion(null);setMessage('读取原创作指导版本…');void newDesignApi.listCardVersions(cardId).then(versions=>{if(!active)return;const original=versions.find(item=>item.id===versionId);if(!original)throw Error('确切原版本未读取，未用当前版本替代。');setVersion(original);setMessage('');}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:'原版本未读取。');});return()=>{active=false;};},[cardId,versionId]);
 if(!version)return <p role="status">{message}</p>;
 return <section aria-label="原创作指导只读版本"><h5>{version.title} · 原版本 {version.revision}</h5><p>确切版本 {version.id} · 适用第 {String(version.values.target_start)}—{String(version.values.target_end)} 章</p><p>原指导保留在谈话记录中；撤销或换稿不会修改此版本。</p></section>;
}
