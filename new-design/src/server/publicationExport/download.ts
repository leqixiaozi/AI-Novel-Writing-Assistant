import { promises as fs } from "node:fs";
import { resolvePublicationArtifact } from "../database/completionExport";
import { NewDesignError } from "../domain/errors";
import { assertNoReparseChain, contained, resolvePrivateRuntimeLayout } from "../runtime/layout";

export async function resolvePublicationExportDownload(id:string):Promise<{path:string;displayFilename:string;mediaType:string}>{
  const artifact=await resolvePublicationArtifact(id);
  if(!artifact.storageLocator.startsWith("exports/"))throw new NewDesignError("导出文件位置不在受管目录。",409);
  const layout=resolvePrivateRuntimeLayout(),target=contained(layout.dataRoot,...artifact.storageLocator.split("/"));
  await assertNoReparseChain(layout.dataRoot,target);
  const stat=await fs.lstat(target).catch(()=>null);
  if(!stat||!stat.isFile()||stat.isSymbolicLink())throw new NewDesignError("导出文件不可用，请重新生成。",404);
  return{path:target,displayFilename:artifact.displayFilename,mediaType:artifact.mediaType};
}
