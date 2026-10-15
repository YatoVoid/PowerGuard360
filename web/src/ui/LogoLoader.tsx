import { BOLT, SHIELD } from "./icons";

// The brand mark drawing itself: the shield's edge traces round, the shield fills, the bolt strikes.
// Same markup and classes as the splash in index.html, whose <style> holds the animation.
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <svg className="pg-loader" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path className="pg-l-edge" d={SHIELD} pathLength={100} />
      <g className="pg-l-fill"><path d={SHIELD} transform="translate(50 50) scale(0.76) translate(-50 -50)" /></g>
      <g className="pg-l-bolt"><path d={BOLT} transform="translate(50 48) scale(0.62) translate(-50 -50)" /></g>
    </svg>
  );
}

// Anything that is loading: the animated mark, with a line saying what is being waited for.
export function LogoLoader({ label, size = 56, inline = false }: { label?: string; size?: number; inline?: boolean }) {
  return (
    <span className={inline ? "pg-loading pg-loading-inline" : "pg-loading"} role="status">
      <LogoMark size={size} />
      {label && <span className="pg-loading-label">{label}</span>}
    </span>
  );
}
