import { create } from "zustand";
import { serverUrl } from "./store";

export interface CopilotMessage {
  id: number;
  role: "user" | "copilot";
  text: string;
  assets?: string[];
  suggestion?: { asset: string; reason: string } | null;
  error?: boolean;
}

interface CopilotStore {
  open: boolean;
  busy: boolean;
  messages: CopilotMessage[];
  setOpen: (open: boolean) => void;
  ask: (question: string, focus?: string | null) => Promise<void>;
  clear: () => void;
}

// The copilot lives on the plant server, which holds the Gemini key; the page never sees it.
export function copilotEndpoint() {
  const ws = serverUrl();
  return ws ? ws.replace(/^ws/, "http").replace(/\/ws$/, "/api/copilot") : null;
}

let nextId = 1;

export const useCopilot = create<CopilotStore>((set, get) => ({
  open: false,
  busy: false,
  messages: [],
  setOpen: (open) => set({ open }),
  clear: () => set({ messages: [] }),
  ask: async (question, focus) => {
    const q = question.trim();
    const url = copilotEndpoint();
    if (!q || get().busy || !url) return;
    const history = get().messages.filter((m) => !m.error).slice(-4).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
    set((s) => ({ open: true, busy: true, messages: [...s.messages, { id: nextId++, role: "user", text: q }] }));
    let reply: CopilotMessage;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.slice(0, 500), focus: focus ?? null, history }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json().catch(() => ({}));
      reply = res.ok
        ? { id: nextId++, role: "copilot", text: body.answer, assets: body.assets, suggestion: body.suggestion }
        : { id: nextId++, role: "copilot", text: body.error ?? "The copilot couldn't answer. Try again.", error: true };
    } catch {
      reply = { id: nextId++, role: "copilot", text: "No answer from the plant server. Check that it's running, then ask again.", error: true };
    }
    set((s) => ({ busy: false, messages: [...s.messages, reply] }));
  },
}));
