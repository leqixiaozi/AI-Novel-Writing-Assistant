import ProfessionalResourcesPage from './professionalResources';
import {newDesignApi} from './api';
import {STRATEGY_RESOURCE_TYPE_KEYS,type StrategyResourceTypeKey} from '../common/contracts';
const api={catalog:newDesignApi.getProfessionalCatalog,command:newDesignApi.executeProfessionalCommand,receipt:newDesignApi.getProfessionalReceipt};
const trialApi={catalog:newDesignApi.getCompositionCatalog,preview:newDesignApi.createCompositionPreview,previewByKey:newDesignApi.getCompositionPreviewByRequest,readPreview:newDesignApi.getCompositionPreview,run:newDesignApi.runCompositionPreview,result:newDesignApi.getCompositionResult};
export default function StrategyResourcesPage() {
 const requested=new URLSearchParams(location.search).get('type') as StrategyResourceTypeKey|null;
 return <ProfessionalResourcesPage api={api} trialApi={trialApi} initialKind={STRATEGY_RESOURCE_TYPE_KEYS.includes(requested as StrategyResourceTypeKey)?requested!:'genre_strategy'} heading="题材与写作策略"/>;
}