/**
 * Particle burst for trade confirmations. Pure DOM canvas, self-cleaning.
 * burst(element) fires from the element's center. Lime = skill/yes, coral = no.
 */
export function burst(
  origin: HTMLElement | { x: number; y: number },
  tone:
    "lime" | "coral" | "ivory" | "sun" | "tomato" | "plum" | "night" = "lime",
  count = 26,
) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect =
    origin instanceof HTMLElement ? origin.getBoundingClientRect() : null;
  const cx = rect ? rect.left + rect.width / 2 : (origin as { x: number }).x;
  const cy = rect ? rect.top + rect.height / 2 : (origin as { y: number }).y;
  const T = "#167d8d";
  const N = "#071b2b";
  const I = "#b9e4e8";
  const lead: Record<string, string[]> = {
    lime: [T, T, N, I],
    sun: [T, T, N, I],
    coral: [N, N, T, I],
    tomato: [N, N, T, I],
    ivory: [I, T, N, I],
    plum: [T, N, I, I],
    night: [N, N, T, I],
  };
  const colors = lead[tone] ?? lead.lime;
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "200",
  });
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, (_, i) => {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const v = 3 + Math.random() * 6;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 3,
      s: 3 + Math.random() * 5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % colors.length],
      square: Math.random() > 0.5,
    };
  });
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 1.1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.square) ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (t < 1.1) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}
