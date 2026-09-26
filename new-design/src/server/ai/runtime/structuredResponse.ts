import {createHash} from 'node:crypto';

export interface OutputSyntaxRepair {kind:'paired_quote_escape';positions:number[];sourceSha256:string;normalizedSha256:string;}

/** Preserve literal prose; only repair an already-open escaped quotation whose
 * closing quote is immediately followed by a prose letter/number inside the value.
 * Never complete a truncated object, infer separators, remove fields, or strip fences. */
export function decodeModelObject(source:string):{value:unknown;outputRepair?:OutputSyntaxRepair} {
  try{return{value:JSON.parse(source)};}catch(original){
    if(Buffer.byteLength(source,'utf8')>2*1024*1024)throw original;
    let inString=false,quoted=false,normalized='';const positions:number[]=[];
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(inString&&ch==='\\'){
        const next=source[++i];if(next==='"')quoted=!quoted;
        normalized+='\\'+(next??'');continue;
      }
      if(ch==='"'){
        if(inString&&quoted&&/[\p{L}\p{N}]/u.test(source[i+1]??'')){
          positions.push(i);if(positions.length>32)throw original;
          normalized+='\\"';quoted=false;continue;
        }
        inString=!inString;quoted=false;
      }
      normalized+=ch;
    }
    if(!positions.length)throw original;
    const value:unknown=JSON.parse(normalized);
    return {value,outputRepair:{kind:'paired_quote_escape',positions,sourceSha256:createHash('sha256').update(source).digest('hex'),normalizedSha256:createHash('sha256').update(normalized).digest('hex')}};
  }
}
