import { useEffect, useState } from "react";
import { PROMPT_COMPONENT_RESOURCE_SPACE_ID, type CardTypeCategory, type CardTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import CardWorkspace from "./CardWorkspace";
import ResourceShell from "./ResourceShell";

export default function PromptComponentsPage() {
  const [types,setTypes]=useState<CardTypeSummary[]>([]);
  const [categories,setCategories]=useState<CardTypeCategory[]>([]);
  const [message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([newDesignApi.listCardTypes(),newDesignApi.listCardTypeCategories()]).then(([nextTypes,nextCategories])=>{setTypes(nextTypes.filter((item)=>item.key==="prompt_component"));setCategories(nextCategories.filter((item)=>item.key==="ai_resources"));}).catch((error)=>setMessage(error instanceof Error?error.message:"提示词组件加载失败。"));},[]);
  return <ResourceShell active="prompts"><div className="nd-resource-boundary"><strong>资源边界</strong><span>这里只保存可复用指令、示例和写作要求。任务合同、提示词配方、动态输出 Schema、模型路由、密钥和运行记录仍是固定系统对象。</span></div>{message?<p className="nd-message is-error">{message}</p>:<CardWorkspace cardTypes={types} categories={categories} spaceId={PROMPT_COMPONENT_RESOURCE_SPACE_ID} workspaceLabel="可复用指令资源" treeAriaLabel="AI 资源类型" contextLabel="AI 资源" createLabel="＋ 新建组件" entityLabel="组件"/>}</ResourceShell>;
}
