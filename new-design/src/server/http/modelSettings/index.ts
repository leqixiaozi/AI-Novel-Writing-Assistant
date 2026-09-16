import { Router } from "express";
import { getIndependentModelStatus, readModelConfiguration, probeModelConnection } from "../../ai";

export function modelSettingsRouter():Router {
  const router=Router();
  router.get("/status",(_request,response)=>response.json({success:true,data:getIndependentModelStatus()}));
  router.post("/probe",(_request,response,next)=>{void probeModelConnection(readModelConfiguration()).then(data=>response.json({success:true,data})).catch(next);});
  return router;
}
