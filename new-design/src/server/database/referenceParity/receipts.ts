import type {PoolClient} from 'pg';
import type {CardGroupFormSummary} from '../../../common/contracts';
import {executeStructureWrite,StructureWriteError} from '../structureWrites';
/** Keep recovery on the book that owns the protected command. */
export async function executeBookFormWrite<T extends CardGroupFormSummary>(bookId:string,key:string,input:unknown,write:(client:PoolClient)=>Promise<T>):Promise<T>{
 try{return await executeStructureWrite('form','save',key,input,write);}
 catch(error){if(error instanceof StructureWriteError){error.recovery.sourceRoute=`/new-design/books/${bookId}/story-setting`;error.recovery.actionLabel='返回本书资料';}throw error;}
}
