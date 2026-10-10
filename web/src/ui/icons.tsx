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
export const IconMark = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden><rect width="32" height="32" rx="7" fill="#2f6fde" /><path d="M9 23V12l7-4 7 4v11" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" /><path d="M17 12l-3 6h4l-3 6" stroke="#ffd166" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconTag = () => (
  <svg {...base}><path d="M3 10V4h6l8 8-6 6z" /><circle cx="7" cy="7" r="1.2" /></svg>
);
export const IconWrench = () => (
  <svg {...base}><path d="M12.5 3.5a4 4 0 0 0-4.6 5.3L3 13.7 6.3 17l4.9-4.9a4 4 0 0 0 5.3-4.6l-2.4 2.4-2.6-.6-.6-2.6z" /></svg>
);
