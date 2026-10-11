import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { MaintenanceRequest } from "../types";

interface Toast { key: string; title: string; body: string; tone: "info" | "watch" | "trip" }

// Pops a notification whenever a maintenance request is raised or changes stage, the same events the phone is told about.
export function Toasts() {
  const requests = useStore((s) => s.plant.requests);
  const now = useStore((s) => s.plant.t);
  const engineers = useStore((s) => s.plant.engineers);
  const seen = useRef(new Map<string, MaintenanceRequest["status"]>());
  const primed = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const fresh: Toast[] = [];
    for (const r of requests) {
      const before = seen.current.get(r.id);
      seen.current.set(r.id, r.status);
      if (!primed.current || before === r.status) continue;
      // A request first seen long after it was raised (page just opened, or just reconnected) is history, not news.
      if (before === undefined && now - r.createdT > 5) continue;
      const who = engineers.find((e) => e.id === r.engineerId)?.name ?? "An engineer";
      const tone = r.priority === "P1" ? "trip" : r.priority === "P2" ? "watch" : "info";
      if (before === undefined) fresh.push({ key: `${r.id}-new`, title: `${r.priority} ${r.id}: ${r.asset}`, body: r.reason, tone });
      else if (r.status === "dispatched") fresh.push({ key: `${r.id}-d`, title: `${r.id} sent to ${who}`, body: "Waiting for them to accept.", tone: "info" });
      else if (r.status === "en-route") fresh.push({ key: `${r.id}-a`, title: `${who} accepted ${r.id}`, body: `Walking to ${r.asset}.`, tone: "info" });
      else if (r.status === "on-site") fresh.push({ key: `${r.id}-o`, title: `${who} reached ${r.asset}`, body: "Repair can start.", tone: "info" });
      else if (r.status === "resolved") fresh.push({ key: `${r.id}-r`, title: `${r.id} resolved`, body: `${r.asset} fixed by ${who}.`, tone: "info" });
    }
    primed.current = true;
    if (!fresh.length) return;
    setToasts((t) => [...fresh, ...t].slice(0, 2));
    const keys = fresh.map((f) => f.key);
    const id = window.setTimeout(() => setToasts((t) => t.filter((x) => !keys.includes(x.key))), 6000);
    return () => window.clearTimeout(id);
  }, [requests, engineers, now]);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast toast-${t.tone}`}>
          <strong>{t.title}</strong>
          <span>{t.body}</span>
        </div>
      ))}
    </div>
  );
}
