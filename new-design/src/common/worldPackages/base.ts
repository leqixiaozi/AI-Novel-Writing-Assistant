import {z} from 'zod';
import type {FieldDefinition} from '../contracts';

export const PUBLIC_WORLD_SPACE_ID='60000000-0000-4000-8000-000000000001';
export const WORLD_PACKAGE_CONTRACT='public_world_package_v1';
export const WORLD_SECTIONS=['profile','rules','factions','forces','locations','relations'] as const;
export type WorldSection=typeof WORLD_SECTIONS[number];
export const WORLD_SECTION_LABELS:Record<WorldSection,string>={profile:'世界概要',rules:'核心规则',factions:'阵营',forces:'势力',locations:'地点',relations:'关系网络'};
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),fieldKey=z.string().min(1).max(100);
const refs=z.array(z.object({cardId:uuid,versionId:uuid,section:z.enum(WORLD_SECTIONS)}).strict()).min(1).max(300).refine(items=>new Set(items.map(item=>item.cardId)).size===items.length,'同一来源对象只能属于一个明确分区。');
export const worldPackageInputSchema=z.object({requestKey:uuid,rootCardId:uuid,rootVersionId:uuid,cards:refs,relationVersionIds:z.array(uuid).max(500).refine(items=>new Set(items).size===items.length)}).strict();
export const worldPackageCommitSchema=worldPackageInputSchema.extend({previewHash:hash});
export type WorldPackageInput=z.infer<typeof worldPackageInputSchema>;
export type WorldPackageCommit=z.infer<typeof worldPackageCommitSchema>;
export interface FrozenWorldCard {cardId:string;versionId:string;section:WorldSection;typeId:string;typeKey:string;typeVersionId:string;title:string;revision:number;values:Record<string,unknown>;localValues:Record<string,unknown>;fields:FieldDefinition[];localFields:Array<{definitionId:string;versionId:string;field:FieldDefinition}>;formVersionId:string|null;formResolutionKind:string;}
export interface FrozenWorldRelation {relationId:string;versionId:string;sourceCardId:string;targetCardId:string;sourceVersionId:string;targetVersionId:string;revision:number;properties:Record<string,unknown>;type:Record<string,unknown>;}
export interface FrozenWorldDictionary {id:string;definition:Record<string,unknown>;nodes:Array<{id:string;versionId:string;snapshot:Record<string,unknown>}>;}
export interface WorldPackageFrame {contract:typeof WORLD_PACKAGE_CONTRACT;rootCardId:string;rootVersionId:string;cards:FrozenWorldCard[];types:Array<{id:string;versionId:string;metadata:Record<string,unknown>;version:Record<string,unknown>}>;relations:FrozenWorldRelation[];forms:Array<{id:string;formId:string;definition:Record<string,unknown>}>;dictionaries:FrozenWorldDictionary[];}
export interface WorldPackagePreview {input:WorldPackageInput;frame:WorldPackageFrame;previewHash:string;}
export interface PublishedWorldPackage {id:string;rootCardId:string;rootVersionId:string;version:number;frame:WorldPackageFrame;frameHash:string;createdAt:string;}
export interface WorldPackageReceipt {requestKey:string;inputHash:string;input:WorldPackageCommit;package:PublishedWorldPackage;repeated:boolean;}
export const worldCatalogActionSchema=z.object({action:z.enum(['archive','restore']),requestKey:uuid,expectedRevision:z.number().int().nonnegative()}).strict();
export type WorldCatalogActionInput=z.infer<typeof worldCatalogActionSchema>;
export interface WorldCatalogActionReceipt {rootCardId:string;status:'active'|'archived';revision:number;requestKey:string;inputHash:string;input:WorldCatalogActionInput&{rootCardId:string};repeated:boolean;}
export interface WorldCatalogState {status:'active'|'archived';revision:number;}
export interface WorldPackageCatalog {capability:{installed:boolean;operational:boolean};archiveAvailable:boolean;items:PublishedWorldPackage[];states:Record<string,WorldCatalogState>;}

const values=z.record(fieldKey,z.unknown()).refine(value=>Object.keys(value).length<=500);
const mapping=z.array(z.object({sourceKey:fieldKey,targetKey:fieldKey,value:z.unknown().refine((value):boolean=>value!==undefined)}).strict().refine(item=>Object.hasOwn(item,'value'))).max(500);
export const worldInstallInputSchema=z.object({requestKey:uuid,packageId:uuid,cards:z.array(z.object({sourceCardId:uuid,requestKey:uuid,targetTypeId:uuid,title:z.string().trim().min(1).max(160),mapping,additionalValues:values}).strict()).min(1).max(300),relations:z.array(z.object({sourceRelationId:uuid,targetTypeId:uuid,properties:values}).strict()).max(500),syncEnabled:z.boolean()}).strict().superRefine((input,ctx)=>{for(const [name,items] of [['来源对象',input.cards.map(item=>item.sourceCardId)],['保存原键',input.cards.map(item=>item.requestKey)],['来源关系',input.relations.map(item=>item.sourceRelationId)]] as const)if(new Set(items).size!==items.length)ctx.addIssue({code:'custom',message:`${name}不能重复。`});if(input.cards.some(item=>item.requestKey===input.requestKey))ctx.addIssue({code:'custom',message:'安装原键与各资料保存原键须独立。'});});
export const worldInstallCommitSchema=z.object({input:worldInstallInputSchema,previewHash:hash}).strict();
export type WorldInstallInput=z.infer<typeof worldInstallInputSchema>;
export type WorldInstallCommit=z.infer<typeof worldInstallCommitSchema>;
export interface WorldInstallTarget {sourceCardId:string;cardTypeId:string;typeVersionId:string;typeRevision:number;formVersionId:string|null;formResolutionKind:'installed_form'|'type_schema';fields:FieldDefinition[];sourceHash:string;values:Record<string,unknown>;}
export interface WorldInstallPreview {bookId:string;input:WorldInstallInput;package:PublishedWorldPackage;targets:WorldInstallTarget[];relationTargets:Record<string,unknown>[];previewHash:string;}
export interface WorldInstallReceipt {bookId:string;installationId:string;origin:'import'|'published_source';requestKey:string;inputHash:string;input:WorldInstallCommit|import('./library').WorldLibraryPublish;packageId:string;cards:Array<{sourceCardId:string;sourceVersionId:string;targetCardId:string;targetVersionId:string;targetTypeVersionId:string;mapping:WorldInstallInput['cards'][number]['mapping']}>;relations:Array<{sourceRelationId:string;sourceVersionId:string;targetRelationId:string;targetVersionId:string;targetTypeId:string}>;sourceRoute:string;repeated:boolean;}

/** Comparison distinguishes absent keys from explicit null, false, 0 and empty values. */
export type WorldValue={present:false}|{present:true;value:unknown};
export interface WorldThreeWayField {key:string;base:WorldValue;local:WorldValue;upstream:WorldValue;status:'unchanged'|'local_only'|'upstream_only'|'converged'|'conflict';}
function canonical(value:unknown):string {return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
function at(value:Record<string,unknown>,key:string):WorldValue{return Object.hasOwn(value,key)?{present:true,value:value[key]}:{present:false};}
export function worldThreeWayFields(base:Record<string,unknown>,local:Record<string,unknown>,upstream:Record<string,unknown>):WorldThreeWayField[]{return [...new Set([...Object.keys(base),...Object.keys(local),...Object.keys(upstream)])].sort().map(key=>{const b=at(base,key),l=at(local,key),u=at(upstream,key),lb=canonical(l)===canonical(b),ub=canonical(u)===canonical(b),lu=canonical(l)===canonical(u);return{key,base:b,local:l,upstream:u,status:lb&&ub?'unchanged':lu?'converged':ub?'local_only':lb?'upstream_only':'conflict'};});}



