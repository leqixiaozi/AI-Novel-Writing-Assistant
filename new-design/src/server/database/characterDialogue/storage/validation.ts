import type {PoolClient} from 'pg';
import {NewDesignError} from '../../../domain/errors';
type Row=Record<string,any>;
const assertions:Record<string,string>={
 character_dialogue_session:'SELECT new_design.assert_character_dialogue_session($1::jsonb,$2::jsonb)',
 character_dialogue_round:'SELECT new_design.assert_character_dialogue_round($1::jsonb,$2::jsonb)',
 character_dialogue_selection:'SELECT new_design.assert_character_dialogue_selection($1::jsonb)',
 character_author_trial:'SELECT new_design.assert_character_author_trial($1::jsonb,$2::jsonb)',
 character_author_influence_candidate:'SELECT new_design.assert_character_author_influence($1::jsonb,$2::jsonb)',
 character_author_influence_decision:'SELECT new_design.assert_character_author_influence_decision($1::jsonb)',
};
export async function validateCharacterRecord(db:PoolClient,kind:string,row:Row,old:Row|null){
 if(old&&['character_dialogue_selection','character_author_influence_decision'].includes(kind))throw new NewDesignError('原作者选择回执不可修改。',409);
 const sql=assertions[kind];if(!sql)throw new NewDesignError('人物记录类型没有对应的来源校验。',500);
 await db.query(sql,sql.includes('$2')?[old?JSON.stringify(old):null,JSON.stringify(row)]:[JSON.stringify(row)]);
}
