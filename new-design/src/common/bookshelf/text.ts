import type {ShelfTextExport} from './index';
export function shelfTextFile(value:ShelfTextExport):{filename:string;text:string}{
 const label=value.scope==='saved'?'已保存稿（含未采用候选）':'正式采用正文（未声明完本）';
 const safe=(text:string)=>text.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').trim().slice(0,100)||'作品';
 const chapters=value.chapters.map(chapter=>`第 ${chapter.order} 章 ${chapter.title}\n${chapter.adopted?'已采用':'未采用候选'} · 保存版本 ${chapter.version}\n\n${chapter.content}`);
 const proofs=value.chapters.map(chapter=>`${chapter.order} · ${chapter.title} · 版本 ${chapter.version} · ${chapter.contentHash}`).join('\n');
 return {filename:safe(value.name)+(value.chapters.length===1?'-'+safe(value.chapters[0].title):'')+'-'+(value.scope==='saved'?'已保存稿':'采用正文')+'.txt',text:`\uFEFF${value.name}\n${label}\n读取时间：${value.readAt}\n保存与下载不会采用正文或修改本书资料。\n\n${chapters.join('\n\n')}\n\n——本次只读版本清单——\n${proofs}\n`};
}
