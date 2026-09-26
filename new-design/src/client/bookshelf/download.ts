import type {ReadingScope,ShelfTextExport} from '../../common/bookshelf';
import {shelfTextFile} from '../../common/bookshelf/text';
import {newDesignApi} from '../api';
export function saveShelfText(value:ShelfTextExport){const file=shelfTextFile(value),url=URL.createObjectURL(new Blob([file.text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function downloadBookText(bookId:string,scope:ReadingScope,chapter?:string){const value=await newDesignApi.getShelfTextExport(bookId,scope,chapter);if(value.bookId!==bookId||value.scope!==scope||!value.chapters.length||chapter&&value.chapters.some(item=>item.id!==chapter))throw Error('下载正文来源不匹配，未下载其他作品或章节。');saveShelfText(value);}
