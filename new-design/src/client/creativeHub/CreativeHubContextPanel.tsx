import type {
  CreativeHubState,
  CreativeHubThread,
  CreativeHubTurn,
} from "../../common/creativeHub";
import { isSafeCreativeHubActionHref } from "./location";

const QUICK_PROMPTS = [
  "请总结当前创作进度，只给我一个最优先的下一步。",
  "当前有哪些阻塞？请说明原因和正式处理入口。",
  "如果我修改当前绑定对象，会影响哪些已有内容？",
];

function nextAction(state: CreativeHubState | null, turns: CreativeHubTurn[]) {
  const latest = [...turns]
    .reverse()
    .find((turn) => turn.status === "succeeded" && turn.result);
  const action = latest?.result?.actions.find((item) =>
    isSafeCreativeHubActionHref(item.href),
  );
  if (action)
    return {
      title: action.label,
      detail: latest?.result?.summary ?? "根据最新诊断回到正式来源处理。",
      href: action.href,
    };
  const source = state?.sourceLinks[0];
  if (state?.blockers.length && source)
    return {
      title: source.label,
      detail: state.blockers[0],
      href: source.href,
    };
  if (!state?.book)
    return {
      title: "先绑定要处理的作品",
      detail: "绑定后，诊断才会读取该作品的章节、任务和阻塞。",
      href: null,
    };
  return {
    title: "询问当前作品的下一步",
    detail: "中枢会基于正式记录给出一个优先入口。",
    href: null,
  };
}

export function CreativeHubContextPanel({
  thread,
  state,
  turns,
  onPrompt,
}: {
  thread: CreativeHubThread;
  state: CreativeHubState | null;
  turns: CreativeHubTurn[];
  onPrompt(value: string): void;
}) {
  const next = nextAction(state, turns);
  return (
    <aside className="nd-hub-context" aria-label="当前创作上下文">
      <section className="nd-hub-next">
        <p className="nd-eyebrow">推荐下一步</p>
        <h3>{next.title}</h3>
        <p>{next.detail}</p>
        {next.href && (
          <a className="nd-button nd-button-primary" href={next.href}>
            打开正式来源
          </a>
        )}
      </section>
      <section>
        <h3>当前绑定</h3>
        <dl className="nd-hub-context-facts">
          <div>
            <dt>作品</dt>
            <dd>{state?.book?.name ?? "未绑定"}</dd>
          </div>
          <div>
            <dt>章节</dt>
            <dd>
              {thread.binding.chapterDocumentId ? "已绑定指定章节" : "全书范围"}
            </dd>
          </div>
          <div>
            <dt>原任务</dt>
            <dd>{thread.binding.taskId ? "已绑定指定记录" : "未指定"}</dd>
          </div>
          <div>
            <dt>会话版本</dt>
            <dd>{thread.revision}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>阻塞与注意</h3>
        {state?.blockers.length ? (
          <ul>
            {state.blockers.slice(0, 6).map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>正式投影未列出阻塞；这不代表所有环节已完成。</p>
        )}
      </section>
      <section>
        <h3>快速诊断</h3>
        <div className="nd-hub-quick-prompts">
          {QUICK_PROMPTS.map((prompt) => (
            <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
