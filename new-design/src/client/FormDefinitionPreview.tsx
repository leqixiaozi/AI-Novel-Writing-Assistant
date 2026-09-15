import type { CardGroupFormDefinition } from "../common/contracts";

export default function FormDefinitionPreview({ definition }: { definition: CardGroupFormDefinition }) {
  return (
    <div className="nd-form-preview">
      {[...definition.groups].sort((a,b)=>a.order-b.order).map((group)=><section key={group.key}>
        <div className="nd-preview-group-heading"><span>{String(group.order).padStart(2,"0")}</span><h3>{group.name}</h3></div>
        {[...group.sections].sort((a,b)=>a.order-b.order).map((section)=><div className="nd-preview-section" key={section.key}><strong>{section.name}</strong><div className="nd-preview-slots">{section.slots.map((slot)=><article key={slot.key}><div><b>{slot.name}</b><small>{slot.kind === "primary_card" ? "主卡" : "引用槽"} · {slot.min}–{slot.max} 张</small></div><span>{slot.allowedTypeKeys.join("、")}</span>{slot.localFields.length ? <p>局部字段：{slot.localFields.map((field)=>field.name).join("、")}</p> : null}</article>)}</div></div>)}
      </section>)}
    </div>
  );
}
