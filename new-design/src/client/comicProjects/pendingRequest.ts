import type {z} from 'zod';

type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function readPendingRequest<T>(store:Store|undefined,keyName:string,payloadName:string,schema:z.ZodType<T>):{key:string|null;input:T|null}{
 let key:string|null=null;try{key=store?.getItem(keyName)??null;const raw=store?.getItem(payloadName);if(!key||!raw)return{key,input:null};const input=schema.parse(JSON.parse(raw));return{key,input:(input as {requestKey?:string}).requestKey===key?input:null};}catch{return{key,input:null};}
}
export function savePendingRequest<T>(store:Store|undefined,keyName:string,payloadName:string,input:T&{requestKey:string}):boolean{
 if(!store)return false;try{store.setItem(payloadName,JSON.stringify(input));store.setItem(keyName,input.requestKey);return true;}catch{clearPendingRequest(store,keyName,payloadName);return false;}
}
export function clearPendingRequest(store:Store|undefined,keyName:string,payloadName:string){try{store?.removeItem(keyName);store?.removeItem(payloadName);}catch{}}
