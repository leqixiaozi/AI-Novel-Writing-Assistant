import { useEffect, useId, useMemo, useState } from "react";
import { buildCardTypeTree, type CardTypeTreeNode } from "../common/cardTypeTree";
import type { CardTypeCategory, CardTypeSummary } from "../common/contracts";

interface CardTypeTreePickerProps {
  label: string;
  cardTypes: CardTypeSummary[];
  categories: CardTypeCategory[];
  selectedKeys: string[];
  availableKeys?: string[];
  single?: boolean;
  disabled?: boolean;
  onChange: (keys: string[]) => void;
}

const UNCATEGORIZED_ID = "client-uncategorized";

export default function CardTypeTreePicker({
  label,
  cardTypes,
  categories,
  selectedKeys,
  availableKeys,
  single = false,
  disabled = false,
  onChange,
}: CardTypeTreePickerProps) {
  const inputName = useId();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const available = useMemo(() => {
    const keySet = availableKeys ? new Set(availableKeys) : null;
    return cardTypes.filter((item) => item.status === "published" && (!keySet || keySet.has(item.key)));
  }, [availableKeys, cardTypes]);
  const treeCategories = useMemo(() => available.some((item) => !item.categoryId)
    ? [...categories, {id:UNCATEGORIZED_ID,key:"uncategorized",name:"其他类型",parentId:null,sortOrder:99_999,status:"active" as const,isSystem:true,revision:1,createdAt:"",updatedAt:""}]
    : categories, [available, categories]);
  const treeTypes = useMemo(() => available.map((item) => item.categoryId ? item : {...item,categoryId:UNCATEGORIZED_ID}), [available]);
  const tree = useMemo(() => buildCardTypeTree(treeCategories, treeTypes, query).filter((node) => node.typeCount > 0), [query, treeCategories, treeTypes]);
  const selectedTypes = available.filter((item) => selectedKeys.includes(item.key));
  const selectedKeySignature = selectedKeys.join("\u0000");
  const selectedLabel = selectedTypes.length
    ? selectedTypes.map((item) => item.name).join("、")
    : selectedKeys.length
      ? `${selectedKeys.length} 个历史类型`
      : "尚未选择";

  useEffect(() => {
    const categoryById = new Map(treeCategories.map((category) => [category.id, category]));
    const selectedCategoryIds = treeTypes.filter((item) => selectedKeys.includes(item.key)).map((item) => item.categoryId).filter((id): id is string => Boolean(id));
    if (!selectedCategoryIds.length) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (let categoryId of selectedCategoryIds) {
        while (categoryId) {
          next.add(categoryId);
          categoryId = categoryById.get(categoryId)?.parentId ?? "";
        }
      }
      return next;
    });
  }, [selectedKeySignature, treeCategories, treeTypes]);

  const toggleCategory = (categoryId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    return next;
  });
  const toggleType = (typeKey: string) => {
    if (single) {
      onChange([typeKey]);
      return;
    }
    const next = new Set(selectedKeys);
    if (next.has(typeKey)) next.delete(typeKey);
    else next.add(typeKey);
    onChange(available.filter((item) => next.has(item.key)).map((item) => item.key));
  };
  const renderNode = (node: CardTypeTreeNode, depth = 0): React.ReactNode => {
    if (!node.typeCount) return null;
    const open = Boolean(query.trim()) || expanded.has(node.category.id);
    return <div className="nd-tree-node" key={node.category.id}>
      <button className="nd-tree-category" style={{ paddingLeft: `${.55 + depth * .8}rem` }} type="button" onClick={() => toggleCategory(node.category.id)} aria-expanded={open}>
        <span>{open ? "⌄" : "›"}</span><strong>{node.category.name}</strong><small>{node.typeCount}</small>
      </button>
      {open && <div>
        {node.children.map((child) => renderNode(child, depth + 1))}
        {node.cardTypes.map((item) => <label className={`nd-type-dictionary-leaf${selectedKeys.includes(item.key) ? " is-selected" : ""}`} style={{ paddingLeft: `${1.65 + depth * .8}rem` }} key={item.id}>
          <input type={single ? "radio" : "checkbox"} name={single ? inputName : undefined} checked={selectedKeys.includes(item.key)} disabled={disabled} onChange={() => toggleType(item.key)} />
          <span><strong>{item.name}</strong><small>{item.description || "已发布内容类型"}</small></span>
        </label>)}
      </div>}
    </div>;
  };

  return <details className={`nd-type-dictionary${disabled ? " is-disabled" : ""}`}>
    <summary><span>{label}</span><strong>{selectedLabel}</strong><small>从中文分类树选择</small></summary>
    {!disabled && <div className="nd-type-dictionary-panel">
      <label className="nd-type-search"><span className="nd-visually-hidden">搜索内容类型</span><input value={query} placeholder="搜索中文类型名称" onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="nd-type-dictionary-tree">{tree.length ? tree.map((node) => renderNode(node)) : <p className="nd-help-text">没有符合条件的已发布内容类型。</p>}</div>
    </div>}
  </details>;
}
