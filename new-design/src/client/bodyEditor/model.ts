/** Existing body versions store plain text. Editor structure is an in-memory projection. */
export interface BodyNode {type:string;text?:string;content?:BodyNode[]}
export interface BodySelectionSnapshot {from:number;to:number;start:number;end:number;text:string;revision:number;document:string}
export function bodyDocument(text:string):BodyNode{return{type:'doc',content:text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))};}
export function bodyText(document:BodyNode):string{
  if(document.type!=='doc')throw new Error('正文文档结构无效。');
  return(document.content??[]).map(paragraph=>{if(paragraph.type!=='paragraph')throw new Error('正文只支持段落，不会丢弃其他格式保存。');return(paragraph.content??[]).map(node=>{if(node.type==='text')return node.text??'';if(node.type==='hardBreak')return '\n';throw new Error('正文包含不支持的内容，未进行有损转换。');}).join('');}).join('\n');
}
/** ProseMirror positions include paragraph boundaries; original body offsets do not. */
export function bodyOffset(document:BodyNode,position:number):number{
  let editorPosition=0,offset=0;const paragraphs=document.content??[];
  for(let index=0;index<paragraphs.length;index++){
    const text=(paragraphs[index].content??[]).map(node=>node.type==='hardBreak'?'\n':node.text??'').join('');
    const start=editorPosition+1,end=start+text.length;
    if(position<=end)return offset+Math.max(0,Math.min(text.length,position-start));
    editorPosition=end+1;offset+=text.length+(index<paragraphs.length-1?1:0);
  }return offset;
}
export function bodySelection(document:BodyNode,from:number,to:number,revision:number):BodySelectionSnapshot|null{
  if(from>=to)return null;const text=bodyText(document),start=bodyOffset(document,from),end=bodyOffset(document,to);if(start>=end)return null;
  return{from,to,start,end,text:text.slice(start,end),revision,document:JSON.stringify(document)};
}
export function selectionStillValid(snapshot:BodySelectionSnapshot,document:BodyNode,revision:number):boolean{
  return snapshot.revision===revision&&snapshot.document===JSON.stringify(document)&&bodyText(document).slice(snapshot.start,snapshot.end)===snapshot.text;
}
