import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCopilot, type CopilotMessage } from "../copilot";
import { useCanControl, useStore } from "../store";
import { assetLabel } from "../sim/site";
import { IconClose, IconSpark } from "./icons";

function AssetLink({ id }: { id: string }) {
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  return <button type="button" className="link" onClick={() => { select(id); setView("twin"); }}>{id}</button>;
}

// Unit ids in an answer become links to that unit in the 3D view.
function withLinks(text: string): ReactNode[] {
  return text.split(/\b(GT-0[1-8])\b/).map((part, i) => (i % 2 ? <AssetLink key={i} id={part} /> : part));
}

function Suggestion({ s }: { s: NonNullable<CopilotMessage["suggestion"]> }) {
  const act = useStore((st) => st.act);
  const open = useStore((st) => st.plant.requests.some((r) => r.asset === s.asset && r.status !== "resolved" && r.status !== "cancelled"));
  const canControl = useCanControl();
  const name = s.asset.startsWith("GT-") ? s.asset : assetLabel(s.asset);
  return (
    <div className="cp-suggest">
      <p><strong>Send an engineer to {name}?</strong> {s.reason}</p>
      {canControl && <button type="button" className="btn btn-primary" disabled={open} onClick={() => act({ type: "request", asset: s.asset, reason: s.reason })}>
        {open ? "Request raised" : "Raise request"}
      </button>}
    </div>
  );
}

function prompts(selected: string | null, top: string | undefined) {
  const list = ["What needs attention right now?"];
  if (selected) list.push(`Explain ${selected.startsWith("GT-") ? selected : assetLabel(selected)} for me`);
  if (top) list.push(`Can we cover demand if ${top} trips?`);
  list.push("Summarize the last few minutes");
  return list;
}

export function CopilotButton() {
  const open = useCopilot((s) => s.open);
  const setOpen = useCopilot((s) => s.setOpen);
  return (
    <button type="button" className={`cp-toggle ${open ? "is-open" : ""}`} aria-label="Copilot" aria-expanded={open} aria-controls="copilot" onClick={() => setOpen(!open)}>
      <IconSpark />
      <span>Copilot</span>
    </button>
  );
}

export function CopilotPanel() {
  const { open, busy, messages, setOpen, ask, clear } = useCopilot();
  const link = useStore((s) => s.link);
  const selected = useStore((s) => s.selected);
  // The unit closest to failing makes the "what if it trips" question worth asking.
  const top = useStore((s) => {
    const soon = s.plant.predictions.filter((p) => p.minutesToFailure !== null).sort((a, b) => a.minutesToFailure! - b.minutesToFailure!)[0];
    return (soon ?? s.plant.predictions[0])?.turbineId;
  });
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const ready = link === "live";

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [messages.length, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const send = (q: string) => { if (!busy && ready) { ask(q, selected); setDraft(""); } };

  return (
    <aside id="copilot" className="copilot" aria-label="Copilot">
      <header className="cp-head">
        <h2>Copilot</h2>
        <span className="cp-model">Gemini</span>
        {messages.length > 0 && <button type="button" className="cp-clear" onClick={clear}>Clear</button>}
        <button type="button" className="cp-close" onClick={() => setOpen(false)} aria-label="Close copilot"><IconClose /></button>
      </header>
      <p className="cp-note">AI-generated from live plant data. Check before acting.</p>

      <ol className="cp-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <li className="cp-empty">{ready ? "Ask about any unit, alarm or request. Answers use the readings, forecasts and work orders on screen right now." : "The copilot runs on the plant server, which isn't connected. Start it, or open the site from the laptop running it."}</li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={`cp-msg cp-${m.role} ${m.error ? "cp-error" : ""}`}>
            <p>{m.role === "copilot" && !m.error ? withLinks(m.text) : m.text}</p>
            {m.suggestion && <Suggestion s={m.suggestion} />}
          </li>
        ))}
        {busy && <li className="cp-msg cp-copilot cp-busy">Reading plant data</li>}
      </ol>

      {ready && (
        <div className="cp-prompts">
          {prompts(selected, top).map((p) => (
            <button key={p} type="button" className="cp-chip" disabled={busy} onClick={() => send(p)}>{p}</button>
          ))}
        </div>
      )}
      <form className="cp-form" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label className="sr-only" htmlFor="cp-input">Question for the copilot</label>
        <textarea
          id="cp-input"
          ref={input}
          rows={2}
          maxLength={500}
          value={draft}
          disabled={!ready}
          placeholder={ready ? "Ask a question" : "Plant server not connected"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
        />
        <button type="submit" className="btn btn-primary" disabled={!ready || busy || !draft.trim()}>Ask</button>
      </form>
    </aside>
  );
}
