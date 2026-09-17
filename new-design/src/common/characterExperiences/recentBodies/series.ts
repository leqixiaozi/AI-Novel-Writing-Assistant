import {z} from 'zod';
import type {RecentBodySelection,RecentBodyExperienceSnapshot} from '.';
export const recentBodySeriesSelectionSchema=z.object({characterIds:z.array(z.string().uuid()).min(1).max(300),chapterDocumentIds:z.array(z.string().uuid()).min(1).max(5)}).strict().refine(input=>new Set(input.characterIds).size===input.characterIds.length&&new Set(input.chapterDocumentIds).size===input.chapterDocumentIds.length,'正文同步完整范围不能重复。');
export interface RecentBodySeriesPreview {bookId:string;selection:RecentBodySelection;snapshot:RecentBodyExperienceSnapshot;sourceHash:string;parts:Array<{characterIds:string[];expectedSourceHash:string}>;}
