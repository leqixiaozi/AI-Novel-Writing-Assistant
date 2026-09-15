import type { WritingControlDefinition, WritingControls, WritingControlValue } from "@ai-novel/shared/types/writingAdjustments";

export const adjustmentInputClass = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
const defaults: WritingControlDefinition[] = [
  { key: "pace", label: "叙述节奏", description: "改变描写和叙述的展开速度，保留既定事件。", bands: ["舒缓", "偏慢", "适中", "紧凑", "极紧凑"], objects: [] },
  { key: "tension", label: "紧张感表达", description: "调整已有压力的表达强度。", bands: ["平静", "轻微", "适中", "强烈", "极强"], objects: [] },
  { key: "suspicionTarget", label: "疑点显著程度", description: "调整指定怀疑事项在文字中的显著程度。", bands: ["极隐晦", "隐晦", "适中", "明显", "突出"], objects: ["subjectId", "objectId", "matter"] },
  { key: "dialogueDirectness", label: "对话直接程度", description: "调整指定人物谈论某件事时的直白程度。", bands: ["极含蓄", "含蓄", "适中", "直接", "极直接"], objects: ["speakerId", "listenerId", "matter"] },
  { key: "characterProminence", label: "人物存在感", description: "调整已出场人物的描写关注程度。", bands: ["背景", "较少", "适中", "较多", "突出"], objects: ["characterId"] },
];
const objectLabels: Record<string, string> = { subjectId: "怀疑者", objectId: "被怀疑者", speakerId: "说话者", listenerId: "听话者", characterId: "人物", matter: "涉及事项" };

export function WritingControlsForm({ controls, onChange, characters, definitions, onlyKeys }: {
  controls: WritingControls;
  onChange: (value: WritingControls) => void;
  characters: Array<{ id: string; name: string }>;
  definitions: WritingControlDefinition[];
  onlyKeys?: Array<WritingControlDefinition["key"]>;
}) {
  const available = defaults.map((fallback) => definitions.find((item) => item.key === fallback.key) ?? fallback);
  return <div className="space-y-4">{available.filter(definition => !onlyKeys || onlyKeys.includes(definition.key)).map((definition) => {
    const value = controls[definition.key] ?? { mode: "inherit" };
    const update = (patch: Partial<WritingControlValue>) => onChange({ ...controls, [definition.key]: { ...value, ...patch } });
    const objects = defaults.find((item) => item.key === definition.key)?.objects ?? [];
    return <div key={definition.key} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">{definition.label}</span>
        <select aria-label={`${definition.label}设置方式`} className={`${adjustmentInputClass} !w-auto`} value={value.mode} onChange={(event) => update({ mode: event.target.value as WritingControlValue["mode"], ...(event.target.value === "set" && value.value === undefined ? { value: 50 } : {}) })}>
          <option value="inherit">沿用上级要求</option><option value="disabled">停用此项</option><option value="set">本次指定</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">{definition.description}</p>
      {value.mode === "set" && <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label={`${definition.label}档位`} className={adjustmentInputClass} value={value.value ?? 50} onChange={(event) => update({ value: Number(event.target.value) })}>
          {[0, 25, 50, 75, 100].map((band, index) => <option key={band} value={band}>{definition.bands[index] ?? "自定义表达"}</option>)}
        </select>
        {objects.map((field) => field === "matter"
          ? <input key={field} aria-label={`${definition.label}涉及事项`} placeholder="涉及什么事" className={adjustmentInputClass} value={value.matter ?? ""} onChange={(event) => update({ matter: event.target.value })} />
          : <select key={field} aria-label={`${definition.label}${objectLabels[field]}`} className={adjustmentInputClass} value={value[field as keyof WritingControlValue] ?? ""} onChange={(event) => update({ [field]: event.target.value })}>
            <option value="">选择{objectLabels[field]}</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>)}
      </div>}
    </div>;
  })}</div>;
}
