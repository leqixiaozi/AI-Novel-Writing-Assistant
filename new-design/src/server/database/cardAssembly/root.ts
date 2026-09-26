import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {updateCardInTransaction} from '../store';

export async function reviseBookRootCard(input:{bookId:string;expectedBookRevision:number;expectedCardRevision:number;values:Record<string,unknown>}){
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query('BEGIN');
    const book=(await client.query('SELECT id,space_id,root_card_id,revision,description FROM new_design.books WHERE id=$1 FOR UPDATE',[input.bookId])).rows[0];
    if(!book)throw new NewDesignError('书籍不存在。',404);
    if(!book.root_card_id)throw new NewDesignError('此书使用旧版开书模板，没有书籍信息根卡。',404);
    if(Number(book.revision)!==input.expectedBookRevision)throw new NewDesignError('书籍信息已变化，请重新读取。',409);
    const name=typeof input.values.bookName==='string'?input.values.bookName.trim():typeof input.values.name==='string'?input.values.name.trim():'';
    if(!name)throw new NewDesignError('书名不能为空。',422);
    const description=typeof input.values.description==='string'?input.values.description:String(book.description??'');
    const card=await updateCardInTransaction(client,String(book.root_card_id),{revision:input.expectedCardRevision,title:name,values:input.values,allowRootCard:true});
    await client.query('UPDATE new_design.books SET name=$2,description=$3,revision=revision+1,updated_at=now() WHERE id=$1',[input.bookId,name,description]);
    await client.query('COMMIT');
    return{bookId:input.bookId,rootCardId:String(book.root_card_id),bookRevision:input.expectedBookRevision+1,card};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
