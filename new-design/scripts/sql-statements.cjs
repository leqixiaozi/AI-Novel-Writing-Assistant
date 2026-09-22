'use strict';

function requireText(source){
 if(typeof source!=='string')throw new TypeError('SQL source must be a string.');
}
function unclosed(kind,offset){return new SyntaxError(`Unclosed SQL ${kind} at offset ${offset}.`);}
function identifierPart(character){return character!==undefined&&/[A-Za-z0-9_$\u0080-\uffff]/.test(character);}
function lineCommentEnd(source,start){
 let index=start+2;
 while(index<source.length&&source[index]!=='\n'&&source[index]!=='\r')index++;
 return index;
}
function blockCommentEnd(source,start){
 let index=start+2,depth=1;
 while(index<source.length){
  if(source[index]==='/'&&source[index+1]==='*'){depth++;index+=2;}
  else if(source[index]==='*'&&source[index+1]==='/'){depth--;index+=2;if(depth===0)return index;}
  else index++;
 }
 throw unclosed('block comment',start);
}
function quotedEnd(source,start,escapeString){
 const quote=source[start];let index=start+1;
 while(index<source.length){
  if(escapeString&&source[index]==='\\'){index+=2;continue;}
  if(source[index]===quote){
   if(source[index+1]===quote){index+=2;continue;}
   return index+1;
  }
  index++;
 }
 throw unclosed(quote==='"'?'quoted identifier':'string literal',start);
}
function dollarDelimiter(source,start){
 // Dollar signs can belong to unquoted identifiers or $1 parameters, not only strings.
 if(identifierPart(source[start-1]))return null;
 if(source[start+1]==='$')return '$$';
 if(!/[A-Za-z_\u0080-\uffff]/.test(source[start+1]??''))return null;
 let index=start+2;
 while(index<source.length&&/[A-Za-z0-9_\u0080-\uffff]/.test(source[index]))index++;
 return source[index]==='$'?source.slice(start,index+1):null;
}

/** Remove only leading whitespace/comments. Quoted content and interior comments are not rewritten. */
function stripLeadingComments(source){
 requireText(source);let index=0;
 while(index<source.length){
  if(/\s/.test(source[index])){index++;continue;}
  if(source[index]==='-'&&source[index+1]==='-'){index=lineCommentEnd(source,index);continue;}
  if(source[index]==='/'&&source[index+1]==='*'){index=blockCommentEnd(source,index);continue;}
  break;
 }
 return source.slice(index).trim();
}

/**
 * Split migration SQL at unquoted semicolons, omitting delimiters and empty/comment-only pieces.
 * Uses PostgreSQL standard_conforming_strings=on, with backslash escapes only in E'...' strings.
 * PL/pgSQL bodies must be quoted (including $$ / $tag$), as in the migration sources.
 * This is a lexical splitter, not SQL validation or a psql/COPY-data interpreter.
 * If recombining results, use "\n;\n" so a retained trailing -- comment cannot swallow a delimiter.
 */
function splitSqlStatements(source){
 requireText(source);
 const statements=[];let start=0,index=0;
 const append=end=>{const statement=stripLeadingComments(source.slice(start,end));if(statement)statements.push(statement);};
 while(index<source.length){
  const character=source[index],next=source[index+1];
  if(character==='-'&&next==='-'){index=lineCommentEnd(source,index);continue;}
  if(character==='/'&&next==='*'){index=blockCommentEnd(source,index);continue;}
  if(character==="'"||character==='"'){
   const escaped=character==="'"&&/[Ee]/.test(source[index-1]??'')&&!identifierPart(source[index-2]);
   index=quotedEnd(source,index,escaped);continue;
  }
  if(character==='$'){
   const delimiter=dollarDelimiter(source,index);
   if(delimiter){const end=source.indexOf(delimiter,index+delimiter.length);if(end<0)throw unclosed('dollar-quoted string',index);index=end+delimiter.length;continue;}
  }
  if(character===';'){append(index);start=++index;continue;}
  index++;
 }
 append(source.length);
 return statements;
}

module.exports={splitSqlStatements,stripLeadingComments};
