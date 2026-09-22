import type {PoolClient} from 'pg';
import {insertSettlementRecords} from '../../chapterSettlement/recordStorage';

/** Keep supplement events in the same immutable session action stream as settlement. */
export function insertSupplementSettlementEvents(client:PoolClient,select:string,parameters:unknown[]){
  return insertSettlementRecords(client,'chapter_settlement_event',select,parameters);
}
