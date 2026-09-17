import type {AssociationWorkspace,AssociationSlotSpec,AssociationItem,CardTypeSummary,CardTypeVersion} from '../../../common/contracts';
import type {AssociationWriteCommand} from '../../../common/referenceParity';
import type {AuthorMaterialWriteInput,AuthorMaterialWriteReceipt} from '../../../common/authorMaterials';
import {newDesignApi} from '../../api';
import {useReferenceCommand} from '../../referenceParity/useCommand';
export type SourceEditor={item:AssociationItem;type:CardTypeSummary;version:CardTypeVersion;title:string;values:Record<string,unknown>};
export type CreateEditor={type:CardTypeSummary;version:CardTypeVersion;title:string;values:Record<string,unknown>};
export interface AssociationDraft {revisions:Record<string,number>;drafts:Record<string,Record<string,unknown>>;picker:AssociationSlotSpec|null;createEditor:CreateEditor|null;sourceEditor:SourceEditor|null;instanceId?:string;localFieldTarget?:AssociationItem|null;}
type Mutation={command:AssociationWriteCommand;raw:AssociationDraft};
export function useAssociationRecovery(bookId:string,primaryId:string,accept:(result:AssociationWorkspace,raw:AssociationDraft,command:AssociationWriteCommand)=>Promise<void>,restore:(raw:AssociationDraft)=>void){
 return useReferenceCommand<Mutation,AssociationWorkspace>(`nd-association-request:${bookId}:${primaryId}`,{
  valid:(value):value is Mutation=>{const input=value as Mutation;return !!input?.raw?.drafts&&!!input.raw.revisions&&typeof input.command?.targetId==='string'&&typeof input.command.input?.idempotencyKey==='string'&&['add_existing','create_and_add','remove','restore','refresh_source','reorder','save_local','add_local_field'].includes(input.command.operation);},
  restore:input=>restore(input.raw),read:input=>newDesignApi.verifyAssociationWrite(bookId,input.command),
  write:({command})=>{switch(command.operation){case 'add_existing':return newDesignApi.addExistingAssociation(bookId,command.targetId,command.input);case 'create_and_add':return newDesignApi.createAndAddAssociation(bookId,command.targetId,command.input);case 'remove':return newDesignApi.removeAssociation(bookId,command.targetId,command.input);case 'restore':return newDesignApi.restoreAssociation(bookId,command.targetId,command.input);case 'refresh_source':return newDesignApi.refreshAssociationSource(bookId,command.targetId,command.input);case 'reorder':return newDesignApi.reorderAssociations(bookId,command.targetId,command.input);case 'save_local':return newDesignApi.saveAssociationLocalValues(bookId,command.targetId,command.input);case 'add_local_field':return newDesignApi.addAssociationLocalField(bookId,command.targetId,command.input);}},
  accept:async(result,input)=>{const command=input.command;if(result.primaryCardId!==primaryId||command.operation==='add_existing'&&!result.items.some(item=>item.source.id===command.input.cardId&&item.slotKey===command.input.slotKey)||input.command.operation==='add_local_field'&&!result.items.some(item=>item.id===input.command.targetId))throw new Error('原关联操作回执未对应当前对象。');await accept(result,input.raw,command);},
 });
}
type SourceCommand={cardId:string;input:AuthorMaterialWriteInput;editor:SourceEditor};
export function useAssociationSourceRecovery(bookId:string,primaryId:string,accept:(receipt:AuthorMaterialWriteReceipt)=>Promise<void>,restore:(editor:SourceEditor)=>void){
 return useReferenceCommand<SourceCommand,AuthorMaterialWriteReceipt>(`nd-association-source-request:${bookId}:${primaryId}`,{
  valid:(value):value is SourceCommand=>{const command=value as SourceCommand;return typeof command?.cardId==='string'&&typeof command.input?.requestKey==='string'&&!!command.editor?.item&&typeof command.input.revision==='number';},
  restore:command=>restore(command.editor),write:command=>newDesignApi.updateAuthorMaterial(bookId,command.cardId,command.input),read:command=>newDesignApi.verifyAssociationSourceWrite(bookId,{cardId:command.cardId,input:command.input}),
  accept:async(receipt,command)=>{if(receipt.bookId!==bookId||receipt.requestKey!==command.input.requestKey||receipt.operation!=='update'||receipt.card.id!==command.cardId||receipt.card.revision!==command.input.revision!+1)throw new Error('原来源保存回执未对应填写。');await accept(receipt);},
 });
}
