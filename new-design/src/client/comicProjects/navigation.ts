import type {ComicEpisode} from '../../common/comicEpisodes';

export const COMIC_PROJECT_TABS=[{key:'outline',label:'大纲'},{key:'characters',label:'角色'},{key:'scenes',label:'场景'},{key:'panels',label:'分镜'},{key:'export',label:'预览与导出'},{key:'source',label:'来源'}] as const;
export type ComicProjectTab=typeof COMIC_PROJECT_TABS[number]['key'];
export function resolveComicProjectTab(params:URLSearchParams):ComicProjectTab|null{const values=params.getAll('tab');if(values.length>1)return null;const value=values[0]??'outline';return COMIC_PROJECT_TABS.find(item=>item.key===value)?.key??null;}
export function selectComicPanelEpisode(episodes:ComicEpisode[],params:URLSearchParams):ComicEpisode|null{const eligible=episodes.filter(item=>item.adoptedVersionId);const values=params.getAll('episode');if(values.length>1)return null;return values.length?eligible.find(item=>item.id===values[0])??null:eligible[0]??null;}
