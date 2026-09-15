import { useEffect, useMemo, useState } from "react";
import type { CardTypeSummary, CardTypeVersion, FieldDefinition } from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import DynamicForm from "./DynamicForm";
import FieldBuilder from "./FieldBuilder";

interface TypeDesignerProps {
  selected: CardTypeSummary | null;
  onSaved: (cardType: CardTypeSummary) => void;
}

function personStarterFields(): FieldDefinition[] {
  return [
    { key: "name", name: "姓名", description: "人物在故事中使用的姓名", type: "short_text", required: true, defaultValue: null, options: [], group: "基本信息", order: 0 },
    { key: "story_role", name: "人物定位", description: "例如主角、导师、对手或关键配角", type: "short_text", required: true, defaultValue: null, options: [], group: "故事职责", order: 1 },
    { key: "personality", name: "性格", description: "写下最影响行动选择的性格特点", type: "long_text", required: false, defaultValue: null, options: [], group: "人物内核", order: 2 },
    { key: "age", name: "年龄", description: "人物当前年龄", type: "number", required: false, defaultValue: null, options: [], group: "基本信息", order: 3 },
  ];
}

function blankType(): CardTypeSummary {
  return {
    id: "",
    key: `type_${Date.now().toString(36)}`,
    name: "",
    description: "",
    status: "draft",
    revision: 1,
    currentVersion: null,
    currentVersionId: null,
    draftFields: [],
    createdAt: "",
    updatedAt: "",
  };
}

export default function TypeDesigner({ selected, onSaved }: TypeDesignerProps) {
  const [draft, setDraft] = useState<CardTypeSummary>(() => selected ?? blankType());
  const [versions, setVersions] = useState<CardTypeVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setDraft(selected ?? blankType());
    setMessage(null);
    if (!selected?.id) {
      setVersions([]);
      return;
    }
    void newDesignApi.listCardTypeVersions(selected.id).then(setVersions).catch(() => setVersions([]));
  }, [selected]);

  const publishedKeys = useMemo(() => new Set((versions[0]?.fields ?? []).map((field) => field.key)), [versions]);
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = draft.id ? await newDesignApi.updateCardType(draft) : await newDesignApi.createCardType(draft);
      setDraft(saved);
      onSaved(saved);
      setMessage({ tone: "success", text: "草稿已保存。" });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : "草稿保存失败。";
      setMessage({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!draft.id) {
      setMessage({ tone: "error", text: "请先保存草稿，再发布版本。" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const published = await newDesignApi.publishCardType(draft.id, draft.revision);
      const nextVersions = await newDesignApi.listCardTypeVersions(draft.id);
      setDraft(published);
      setVersions(nextVersions);
      onSaved(published);
      setMessage({ tone: "success", text: `版本 v${published.currentVersion} 已发布，可以创建卡片。` });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : "发布失败。";
      setMessage({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nd-designer-grid">
      <div className="nd-editor-column">
        <section className="nd-section nd-type-overview">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">元卡片类型</p>
              <h1>{draft.id ? draft.name || "未命名类型" : "新建元卡片类型"}</h1>
            </div>
            <span className={`nd-status nd-status-${draft.status}`}>
              {draft.currentVersion ? `已发布 v${draft.currentVersion}` : "草稿"}
            </span>
          </div>
          <div className="nd-grid-2">
            <label className="nd-control">
              <span>类型名称</span>
              <input value={draft.name} placeholder="例如：人物" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="nd-control nd-control-wide">
              <span>用途说明</span>
              <input value={draft.description} placeholder="这类卡片帮助作者记录什么" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
          </div>
          {!draft.id && draft.draftFields.length === 0 && (
            <button className="nd-inline-action" type="button" onClick={() => setDraft({ ...draft, name: draft.name || "人物", description: draft.description || "记录故事人物的身份、职责与性格。", draftFields: personStarterFields() })}>
              使用人物字段示例开始
            </button>
          )}
        </section>

        <FieldBuilder fields={draft.draftFields} publishedKeys={publishedKeys} onChange={(draftFields) => setDraft({ ...draft, draftFields })} />

        <footer className="nd-sticky-actions">
          <div>
            {message && <p className={`nd-message is-${message.tone}`}>{message.text}</p>}
            {!message && <p className="nd-save-hint">先保存草稿；确认字段后再发布为不可变版本。</p>}
          </div>
          <div className="nd-action-row">
            <button className="nd-button nd-button-secondary" type="button" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? "处理中…" : "保存草稿"}</button>
            <button className="nd-button nd-button-primary" type="button" disabled={busy || !draft.id || draft.draftFields.length === 0} onClick={publish}>发布新版本</button>
          </div>
        </footer>
      </div>

      <aside className="nd-preview-column">
        <div className="nd-preview-header">
          <p className="nd-kicker">实时表单预览</p>
          <span>{draft.draftFields.length} 个字段</span>
        </div>
        <div className="nd-preview-paper">
          <div className="nd-preview-title">
            <span>FORM · {String((draft.currentVersion ?? 0) + 1).padStart(2, "0")}</span>
            <h2>{draft.name || "未命名卡片"}</h2>
            <p>{draft.description || "填写类型说明后，作者会在这里理解表单用途。"}</p>
          </div>
          <DynamicForm fields={draft.draftFields} values={{}} preview />
        </div>
      </aside>
    </div>
  );
}
