import type {AddInformationFieldInput,FormResolutionKind} from '../contracts';
type Base={idempotencyKey:string;createdBy?:string};
type Revision=Base&{expectedRevision:number};
export type AssociationWriteCommand=
 |{operation:'add_existing';targetId:string;input:Base&{slotKey:string;cardId:string;expectedInstanceRevision:number|null;instanceId?:string;associationFormVersionId?:string;expectedSourceCardVersionId?:string}}
 |{operation:'create_and_add';targetId:string;input:Base&{slotKey:string;cardTypeId:string;title:string;values:Record<string,unknown>;expectedInstanceRevision:number|null;instanceId?:string;associationFormVersionId?:string;targetTypeVersionId?:string;formVersionId?:string|null;formResolutionKind:FormResolutionKind}}
 |{operation:'remove'|'restore';targetId:string;input:Revision}
 |{operation:'refresh_source';targetId:string;input:Revision&{expectedSourceRevision:number}}
 |{operation:'reorder';targetId:string;input:Base&{instanceId?:string;items:Array<{mountId:string;expectedRevision:number}>}}
 |{operation:'save_local';targetId:string;input:Revision&{values:Record<string,unknown>}}
 |{operation:'add_local_field';targetId:string;input:Revision&{field:AddInformationFieldInput;initialValue?:unknown}};
