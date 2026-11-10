"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface OrbitTrader {
  id: string;
  name: string;
  profitRank: number;
  trustRank: number;
}

interface Body {
  trader: OrbitTrader;
  ring: number; // 0..1, 0 = closest to the core (most trusted)
  size: number; // bubble radius in px (profit)
  speed: number;
  phase: number;
  tilt: number;
  solid: boolean;
}
interface Dash {
  t0: number;
  from: { x: number; y: number };
  trail: { x: number; y: number }[];
}
interface Hover {
  x: number;
  y: number;
  trader: OrbitTrader;
}

const NAVY = "#071b2b";
const ICE = "#b9e4e8";
const TEAL = "#167d8d";
const FOG = "#eeeeee";

const ease = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

/**
 * The product, as an object. Distance from the core is how much a wallet's
 * track record is trusted; bubble size is how much money it made. Big and far
 * away means lucky. Small and close means skilled. Software agents dash in to
 * buy the report.
 */
export function OrbitScene({
  traders,
  crowd,
  record,
  marketTitle,
}: {
  traders: OrbitTrader[];
  crowd: number;
  record: number;
  marketTitle: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hits, setHits] = useState<number[]>([]);
  const pointer = useRef({ x: 0, y: 0, inside: false, cx: 0, cy: 0 });

  const bodies = useMemo<Body[]>(() => {
    const n = Math.max(2, traders.length);
    return traders.map((trader, i) => ({
      trader,
      ring: (trader.trustRank - 1) / (n - 1),
      size: 9 + ((n - trader.profitRank) / (n - 1)) * 24,
      speed:
        (0.5 - ((trader.trustRank - 1) / (n - 1)) * 0.32) * (i % 2 ? -1 : 1),
      phase: (i / n) * Math.PI * 2 + 0.6,
      tilt: [-0.28, 0.2, -0.1, 0.32, -0.2, 0.12, -0.34, 0.26][i % 8],
      solid: trader.trustRank <= Math.ceil(n / 2),
    }));
  }, [traders]);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let w = 0,
      h = 0,
      dpr = 1,
      raf = 0,
      running = true;
    const stars = Array.from({ length: 110 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2 + 0.3,
      p: Math.random() * 6,
    }));
    const dashes: Dash[] = [];
    const ripples: { t0: number }[] = [];
    let nextDash = 1800;
    let tiltK = 0.36;
    let splash = 0;
    const bubbles = Array.from({ length: 16 }, () => ({
      x: Math.random() * 2 - 1,
      p: Math.random(),
      s: 0.12 + Math.random() * 0.2,
      r: 1.5 + Math.random() * 3,
    }));
    let swing = 0;
    let hoverId: string | null = null;
    const place = new Map<string, { x: number; y: number; r: number }>();

    const resize = () => {
      const r = box.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      box.style.setProperty("--cx", `${w > 900 ? w * 0.6 : w * 0.5}px`);
      box.style.setProperty("--cy", `${w > 900 ? h * 0.46 : h * 0.4}px`);
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      if (running && !reduce) raf = requestAnimationFrame(frame);
    });
    io.observe(box);

    const frame = (now: number) => {
      if (!running) return;
      const t = reduce ? 3000 : now;
      const unit = Math.min(w, h * 1.45) / 2;
      const cx = w > 900 ? w * 0.6 : w * 0.5;
      const cy = w > 900 ? h * 0.46 : h * 0.4;
      const coreR = unit * 0.2;

      const p = pointer.current;
      const tx = p.inside ? (p.x / w - 0.5) * 2 : 0;
      const ty = p.inside ? (p.y / h - 0.5) * 2 : 0;
      tiltK += (0.36 + ty * 0.13 - tiltK) * 0.05;
      swing += (tx * 0.16 - swing) * 0.05;

      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        ctx.globalAlpha = 0.25 + 0.35 * Math.sin(t / 1400 + s.p);
        ctx.fillStyle = FOG;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const project = (r: number, ang: number, tilt: number) => {
        const x0 = r * Math.cos(ang);
        const y0 = r * Math.sin(ang) * tiltK;
        const rot = tilt + swing;
        const x = x0 * Math.cos(rot) - y0 * Math.sin(rot);
        const y = x0 * Math.sin(rot) + y0 * Math.cos(rot);
        return { x: cx + x, y: cy + y, z: Math.sin(ang) };
      };

      // orbit paths
      for (const b of bodies) {
        const r = unit * (0.34 + b.ring * 0.4);
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.06) {
          const q = project(r, a, b.tilt);
          if (a === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.strokeStyle =
          b.trader.id === hoverId ? ICE : "rgba(185,228,232,0.16)";
        ctx.lineWidth = b.trader.id === hoverId ? 1.5 : 1;
        ctx.stroke();
      }
      // outer agent lane
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.06) {
        const q = project(unit * 0.93, a, 0.05);
        if (a === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = "rgba(185,228,232,0.28)";
      ctx.stroke();
      ctx.setLineDash([]);

      type Item = { z: number; draw: () => void };
      const items: Item[] = [];
      place.clear();

      for (const b of bodies) {
        const r = unit * (0.34 + b.ring * 0.4);
        const ang = b.phase + (t / 1000) * b.speed;
        const q = project(r, ang, b.tilt);
        const scale = 1 + q.z * 0.22;
        const rad = b.size * scale * Math.min(1, unit / 260 + 0.45);
        place.set(b.trader.id, { x: q.x, y: q.y, r: rad });
        items.push({
          z: q.z,
          draw: () => {
            const on = b.trader.id === hoverId;
            ctx.beginPath();
            ctx.arc(q.x, q.y, rad + (on ? 3 : 0), 0, Math.PI * 2);
            if (b.solid) {
              ctx.fillStyle = on ? FOG : ICE;
              ctx.fill();
            } else {
              ctx.fillStyle = "rgba(7,27,43,0.85)";
              ctx.fill();
              ctx.setLineDash([3, 3]);
              ctx.strokeStyle = on ? FOG : ICE;
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.setLineDash([]);
            }
            if (rad >= 10) {
              ctx.fillStyle = b.solid ? NAVY : ICE;
              ctx.font = `700 ${Math.round(rad * 0.9)}px "Hanken Grotesk Variable", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(b.trader.name.charAt(0), q.x, q.y + 0.5);
            }
          },
        });
      }

      // resting agents on the outer lane
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 - (t / 1000) * 0.18;
        const q = project(unit * 0.93, ang, 0.05);
        items.push({
          z: q.z,
          draw: () => {
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(Math.PI / 4 + t / 3000);
            ctx.fillStyle = TEAL;
            ctx.fillRect(-5, -5, 10, 10);
            ctx.strokeStyle = FOG;
            ctx.lineWidth = 1.2;
            ctx.strokeRect(-5, -5, 10, 10);
            ctx.restore();
          },
        });
      }

      // core sphere sits at z = 0
      const core = () => {
        for (const rp of ripples) {
          const a = (t - rp.t0) / 1300;
          if (a < 0 || a > 1) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, coreR * (1.05 + a * 1.1), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(185,228,232,${0.7 * (1 - a)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        splash *= 0.972;
        // glass
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.clip();
        const glass = ctx.createRadialGradient(
          cx,
          cy,
          coreR * 0.2,
          cx,
          cy,
          coreR,
        );
        glass.addColorStop(0, "#0d2c3f");
        glass.addColorStop(1, "#071b2b");
        ctx.fillStyle = glass;
        ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);
        // liquid: its level IS the track-record probability. Hue drifts slowly.
        const level = Math.max(0.04, Math.min(0.96, record / 100));
        const surface = cy + coreR - coreR * 2 * level;
        const drift = (Math.sin(t / 2600) + 1) / 2;
        const mix = (a: number, b: number) => Math.round(a + (b - a) * drift);
        const wave = (
          amp: number,
          len: number,
          speed: number,
          phase: number,
        ) => {
          ctx.beginPath();
          ctx.moveTo(cx - coreR - 2, cy + coreR + 2);
          for (let x = -coreR - 2; x <= coreR + 2; x += 4) {
            const y =
              surface +
              Math.sin(x / len + (t / 1000) * speed + phase) *
                amp *
                (1 + splash * 2.6);
            ctx.lineTo(cx + x, y);
          }
          ctx.lineTo(cx + coreR + 2, cy + coreR + 2);
          ctx.closePath();
        };
        wave(7, 22, 1.4, 1.2);
        ctx.fillStyle = `rgba(${mix(22, 111)},${mix(125, 186)},${mix(141, 196)},0.45)`;
        ctx.fill();
        wave(6, 17, -1.9, 0);
        const lg = ctx.createLinearGradient(0, surface, 0, cy + coreR);
        lg.addColorStop(
          0,
          `rgb(${mix(47, 138)},${mix(147, 205)},${mix(162, 214)})`,
        );
        lg.addColorStop(
          1,
          `rgb(${mix(16, 22)},${mix(95, 125)},${mix(112, 141)})`,
        );
        ctx.fillStyle = lg;
        ctx.fill();
        // swirl inside the liquid
        if (ctx.createConicGradient) {
          const cg = ctx.createConicGradient(t / 4000, cx, cy + coreR * 0.3);
          cg.addColorStop(0, "rgba(238,238,238,0.16)");
          cg.addColorStop(0.25, "rgba(238,238,238,0)");
          cg.addColorStop(0.6, "rgba(185,228,232,0.14)");
          cg.addColorStop(1, "rgba(238,238,238,0.16)");
          ctx.globalCompositeOperation = "source-atop";
          ctx.fillStyle = cg;
          ctx.fillRect(cx - coreR, surface, coreR * 2, cy + coreR - surface);
          ctx.globalCompositeOperation = "source-over";
        }
        // bubbles rise through the liquid
        for (const bub of bubbles) {
          const prog = ((t / 1000) * bub.s + bub.p) % 1;
          const by = cy + coreR - prog * (cy + coreR - surface);
          const bx =
            cx + bub.x * coreR * 0.85 + Math.sin(prog * 9 + bub.p * 6) * 5;
          ctx.beginPath();
          ctx.arc(bx, by, bub.r * (1 - prog * 0.4), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(238,238,238,${0.5 * (1 - prog)})`;
          ctx.fill();
        }
        // crowd line: where the market price sits
        const crowdY =
          cy + coreR - coreR * 2 * Math.max(0.04, Math.min(0.96, crowd / 100));
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(cx - coreR, crowdY);
        ctx.lineTo(cx + coreR, crowdY);
        ctx.strokeStyle = "rgba(238,238,238,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        // glass highlight
        const hl = ctx.createRadialGradient(
          cx - coreR * 0.4,
          cy - coreR * 0.5,
          0,
          cx - coreR * 0.4,
          cy - coreR * 0.5,
          coreR * 0.7,
        );
        hl.addColorStop(0, "rgba(238,238,238,0.16)");
        hl.addColorStop(1, "rgba(238,238,238,0)");
        ctx.fillStyle = hl;
        ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(238,238,238,0.5)";
        ctx.stroke();
      };

      const back = items.filter((i) => i.z < 0).sort((a, b) => a.z - b.z);
      const front = items.filter((i) => i.z >= 0).sort((a, b) => a.z - b.z);
      back.forEach((i) => i.draw());
      core();
      front.forEach((i) => i.draw());

      // agent dashes: spawn, fly to the core along a curve, ripple on arrival
      if (!reduce && t > nextDash) {
        const ang = Math.random() * Math.PI * 2;
        const q = project(unit * 0.93, ang, 0.05);
        dashes.push({ t0: t, from: { x: q.x, y: q.y }, trail: [] });
        nextDash = t + 2300 + Math.random() * 1400;
      }
      for (let i = dashes.length - 1; i >= 0; i--) {
        const d = dashes[i];
        const pr = Math.min(1, (t - d.t0) / 1500);
        const e = ease(pr);
        const mx = (d.from.x + cx) / 2 + (d.from.y - cy) * 0.35;
        const my = (d.from.y + cy) / 2 - (d.from.x - cx) * 0.35;
        const x =
          (1 - e) * (1 - e) * d.from.x + 2 * (1 - e) * e * mx + e * e * cx;
        const y =
          (1 - e) * (1 - e) * d.from.y + 2 * (1 - e) * e * my + e * e * cy;
        d.trail.push({ x, y });
        if (d.trail.length > 26) d.trail.shift();
        ctx.beginPath();
        d.trail.forEach((pt, k) =>
          k ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y),
        );
        ctx.strokeStyle = `rgba(238,238,238,${0.55 * (1 - pr * 0.5)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = FOG;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
        if (pr >= 1) {
          dashes.splice(i, 1);
          ripples.push({ t0: t });
          splash = 1;
          if (ripples.length > 4) ripples.shift();
          setHits((h) => [...h.slice(-3), t]);
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.current = { x, y, inside: true, cx: r.left, cy: r.top };
      let found: Hover | null = null;
      let best = 1e9;
      for (const b of bodies) {
        const pl = place.get(b.trader.id);
        if (!pl) continue;
        const d = Math.hypot(pl.x - x, pl.y - y);
        if (d < pl.r + 10 && d < best) {
          best = d;
          found = { x: pl.x, y: pl.y, trader: b.trader };
        }
      }
      hoverId = found?.trader.id ?? null;
      setHover(found);
      box.style.cursor = found ? "pointer" : "default";
    };
    const onLeave = () => {
      pointer.current.inside = false;
      hoverId = null;
      setHover(null);
    };
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      running = false;
      ro.disconnect();
      io.disconnect();
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerleave", onLeave);
    };
  }, [bodies, crowd, record]);

  return (
    <div
      ref={wrap}
      className="absolute inset-0"
      role="img"
      aria-label={`Orbit diagram. ${marketTitle}: crowd ${crowd} percent, track-record view ${record} percent. Wallets orbit closer the more their track record is trusted; larger bubbles made more profit.`}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="text-fog absolute -translate-x-1/2 -translate-y-[44%] text-center"
          style={{ left: "var(--cx, 50%)", top: "var(--cy, 45%)" }}
        >
          <div className="text-fog text-[0.7rem] font-semibold tracking-wide uppercase [text-shadow:0_1px_10px_rgb(7_27_43/0.7)]">
            Track-record view
          </div>
          <div className="num font-display text-[clamp(2.6rem,6vw,4.6rem)] leading-none font-bold [text-shadow:0_2px_16px_rgb(7_27_43/0.6)]">
            {record}
            <span className="text-[0.5em]">%</span>
          </div>
          <div className="text-fog mt-1 text-xs [text-shadow:0_1px_8px_rgb(7_27_43/0.7)]">
            crowd <span className="num font-semibold">{crowd}%</span>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <AnimatePresence>
          {hits.slice(-1).map((id) => (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: -46, scale: 1 }}
              transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
              className="num bg-fog text-navy absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[9.5rem] rounded-full px-3 py-1 text-xs font-bold"
            >
              agent bought report, 0.01 USDC
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {hover && (
          <motion.div
            key={hover.trader.id}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{ left: hover.x, top: hover.y }}
            className="bg-fog text-navy pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-[calc(100%+22px)] rounded-xl px-3 py-2 shadow-lg"
          >
            <div className="text-sm font-bold">{hover.trader.name}</div>
            <div className="num text-xs">
              #{hover.trader.profitRank} by profit, #{hover.trader.trustRank} by
              track record
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
