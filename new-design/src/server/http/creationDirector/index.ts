import type {Router} from "express";
import type {NewDesignAiGateway} from "../../ai/gateway";
import {directorCommandSchema,directorControlSchema,executeCreationDirector} from "../../application/creationDirector";
import {controlCreationDirector} from "../../database/creationDirector";
import {NewDesignError} from "../../domain/errors";

export function mountCreationDirector(router:Router,ai?:NewDesignAiGateway){
  router.patch("/book-creation/sessions/:id/director",(req,res,next)=>{const parsed=directorControlSchema.safeParse(req.body);if(!parsed.success){next(new NewDesignError("请核对开书模式和阶段。",422));return;}void controlCreationDirector(String(req.params.id),parsed.data).then(data=>res.json({success:true,data}),next);});
  router.post("/book-creation/sessions/:id/director/prepare",(req,res,next)=>{const parsed=directorCommandSchema.safeParse(req.body);if(!parsed.success){next(new NewDesignError("请重新发起本阶段准备。",422));return;}void executeCreationDirector(String(req.params.id),parsed.data,ai).then(data=>res.json({success:true,data}),next);});
}
