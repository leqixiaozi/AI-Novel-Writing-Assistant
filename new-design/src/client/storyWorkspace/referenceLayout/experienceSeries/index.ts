import {useEffect,useMemo,useReducer,useRef} from 'react';
import type {ExperienceRecord} from '../../../../common/characterExperiences';
import {newDesignApi,ApiError} from '../../../api';
import {ExperienceSeriesController} from './controller';
export function useExperienceSeries(bookId:string,characterId:string,onResult:(record:ExperienceRecord)=>void){
 const [,update]=useReducer(value=>value+1,0),result=useRef(onResult);result.current=onResult;
 const controller=useMemo(()=>new ExperienceSeriesController({key:`nd-experience-series:${bookId}:${characterId}`,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},bookId,characterId,uuid:()=>crypto.randomUUID(),prepare:input=>newDesignApi.prepareExperienceSeries(bookId,input),write:input=>newDesignApi.generateExperiences(bookId,input),read:input=>newDesignApi.readExperienceOriginal(bookId,input),endUnknown:input=>newDesignApi.endUnknownExperiences(bookId,input),notWritten:error=>error instanceof ApiError&&error.recovery?.mutationOutcome==='not_written',changed:()=>update(),result:record=>result.current(record)}),[bookId,characterId]);
 useEffect(()=>{controller.restore();return()=>controller.cancel();},[controller]);
 return controller;
}
