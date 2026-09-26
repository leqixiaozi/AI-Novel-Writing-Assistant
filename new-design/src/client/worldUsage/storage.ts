import {z} from 'zod';
import {worldUsageSelectionSchema,type WorldUsageSelection} from '../../common/worldUsage';

const pendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('prepare'),input:z.object({requestKey:z.string().uuid(),mode:z.enum(['manual','ai']),expectedSourceHash:z.string(),selection:worldUsageSelectionSchema.optional(),instruction:z.string()}).strict()}).strict(),
 z.object({kind:z.literal('adopt'),input:z.object({requestKey:z.string().uuid(),candidateId:z.string().uuid(),expectedSourceHash:z.string(),expectedCurrentVersion:z.number().int().nonnegative()}).strict()}).strict(),
]);
export type WorldUsagePending=z.infer<typeof pendingSchema>;
export const emptyWorldUsageSelection:WorldUsageSelection={primaryLocationId:null,factionIds:[],locationIds:[],ruleIds:[],boundary:''};

export function readWorldUsageFrame(key:string){
 try{
  const raw=sessionStorage.getItem(key);
  if(!raw)return{selection:emptyWorldUsageSelection,instruction:'',pending:null as WorldUsagePending|null,broken:false,hasFrame:false};
  const frame=JSON.parse(raw),selection=worldUsageSelectionSchema.parse(frame.selection),instruction=z.string().max(2000).parse(frame.instruction??''),pending=frame.pending?pendingSchema.parse(frame.pending):null;
  return{selection,instruction,pending,broken:false,hasFrame:true};
 }catch{return{selection:emptyWorldUsageSelection,instruction:'',pending:null as WorldUsagePending|null,broken:true,hasFrame:true};}
}

export function writeWorldUsageFrame(key:string,selection:WorldUsageSelection,pending:WorldUsagePending|null,instruction:string){
 sessionStorage.setItem(key,JSON.stringify({selection,pending,instruction}));
}
