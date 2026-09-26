import ProfessionalResourcesPage from '../professionalResources';
import {newDesignApi} from '../api';
import type {ProfessionalResourceKind} from '../../common/professionalResources';
const kinds:readonly ProfessionalResourceKind[]=['character'];
const api={
 catalog:async()=>{const catalog=await newDesignApi.getProfessionalCatalog();return{...catalog,resources:catalog.resources.filter(item=>item.kind==='character'),types:catalog.types.filter(item=>item.kind==='character')};},
 command:newDesignApi.executeProfessionalCommand,receipt:newDesignApi.getProfessionalReceipt,
};
const trialApi={catalog:newDesignApi.getCompositionCatalog,preview:newDesignApi.createCompositionPreview,previewByKey:newDesignApi.getCompositionPreviewByRequest,readPreview:newDesignApi.getCompositionPreview,run:newDesignApi.runCompositionPreview,result:newDesignApi.getCompositionResult};
export default function PublicCharacterLibrary(){return <ProfessionalResourcesPage api={api} trialApi={trialApi} initialKind="character" heading="公共角色样本库" kinds={kinds}/>;}
