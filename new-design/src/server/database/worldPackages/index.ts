import {worldPackageInputSchema,worldPackageCommitSchema,type WorldPackageInput,type WorldPackageCommit,type WorldPackageReceipt,type PublishedWorldPackage} from '../../../common/worldPackages';
import {assertFound} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {freezeWorldPackage} from './freeze';
import {readWorldOriginal,writeWorldOriginal} from './receipts';
import {worldPackageCapability} from './capability';
import {publishWorldPackageInTransaction} from './publication';
export {getWorldPackageCatalog,getBookWorldSyncWorkspace,getWorldInstallationFields,getWorldSyncHistory} from './workspace';
export {changeWorldPackageAvailability,readWorldCatalogActionOriginal} from './availability';
export {previewWorldSync,saveWorldSync,readWorldSyncOriginal} from './synchronization';
export {getWorldLibraryWorkspace,previewWorldLibrary,prepareWorldLibrary,previewWorldLibraryPublish,publishWorldLibrary,readWorldLibraryOriginal} from './library';
export {WorldPackageWriteError} from './receipts';
export {previewWorldInstallation,installWorldPackage,readWorldInstallationOriginal} from './install';
export async function getWorldPackageCapability(){return worldPackageCapability(await getNewDesignPool());}
export async function previewWorldPackage(input:WorldPackageInput){const parsed=worldPackageInputSchema.parse(input),db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await freezeWorldPackage(db,parsed);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
export async function readPublishedWorldPackage(id:string):Promise<PublishedWorldPackage>{const pool=await getNewDesignPool();const row=assertFound((await pool.query('SELECT receipt FROM new_design.world_package_versions WHERE id=$1',[id])).rows[0],'公共世界包版本不存在。');return row.receipt.package;}
export function readWorldPackageOriginal(input:WorldPackageCommit){return readWorldOriginal<WorldPackageReceipt>('public',worldPackageCommitSchema.parse(input));}
export function publishWorldPackage(input:WorldPackageCommit):Promise<WorldPackageReceipt>{const parsed=worldPackageCommitSchema.parse(input);return writeWorldOriginal('public',parsed,db=>publishWorldPackageInTransaction(db,parsed));}
