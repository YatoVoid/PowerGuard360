// Line icons drawn on a 20px grid with a 1.6 stroke, matching the type weight.
const base = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconPlant = () => (
  <svg {...base}><path d="M3 17V9l4 2V8l4 2V4h3v13z" /><path d="M2 17h16" /></svg>
);
export const IconDashboard = () => (
  <svg {...base}><rect x="3" y="3" width="6" height="8" rx="1" /><rect x="11" y="3" width="6" height="5" rx="1" /><rect x="11" y="10" width="6" height="7" rx="1" /><rect x="3" y="13" width="6" height="4" rx="1" /></svg>
);
export const IconTruck = () => (
  <svg {...base}><path d="M2 5h10v9H2z" /><path d="M12 8h3l3 3v3h-6" /><circle cx="6" cy="15" r="1.6" /><circle cx="14.5" cy="15" r="1.6" /></svg>
);
export const IconBell = () => (
  <svg {...base}><path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 1.5h-13z" /><path d="M8.5 17.5a1.6 1.6 0 0 0 3 0" /></svg>
);
// Brand mark: a shield (guard) holding a lightning bolt (power), framed by a second outline.
// "color" sits on light backgrounds, "reverse" on the navy sidebar; the outline turns white there so it still reads.
export const SHIELD = "M50 4 L88 17 V46 C88 70 72 87 50 96 C28 87 12 70 12 46 V17 Z";
export const BOLT = "M57 16 L33 54 H47 L41 84 L67 44 H53 Z";
export const BrandMark = ({ size = 28, variant = "color" }: { size?: number; variant?: "color" | "reverse" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="brand-mark">
    <path d={SHIELD} fill="none" stroke={variant === "reverse" ? "#fff" : "var(--brand-navy)"} strokeWidth="5.5" strokeLinejoin="round" />
    <path d={SHIELD} fill="var(--accent)" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" transform="translate(50 50) scale(0.76) translate(-50 -50)" />
    <path d={BOLT} fill="var(--bolt)" stroke="var(--bolt)" strokeWidth="2" strokeLinejoin="round" transform="translate(50 48) scale(0.62) translate(-50 -50)" />
  </svg>
);
export const IconTag = () => (
  <svg {...base}><path d="M3 10V4h6l8 8-6 6z" /><circle cx="7" cy="7" r="1.2" /></svg>
);
export const IconWrench = () => (
  <svg {...base}><path d="M12.5 3.5a4 4 0 0 0-4.6 5.3L3 13.7 6.3 17l4.9-4.9a4 4 0 0 0 5.3-4.6l-2.4 2.4-2.6-.6-.6-2.6z" /></svg>
);
export const IconSpark = () => (
  <svg {...base}><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z" /><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
);
export const IconClose = () => (
  <svg {...base}><path d="M5 5l10 10M15 5L5 15" /></svg>
);
