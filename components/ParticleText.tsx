"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";

export type ParticleTextProps = {
  text?: string;
  font?: {
    fontFamily?: string;
    fontWeight?: number | string;
    fontStyle?: string;
  };
  color?: string;
  color2?: string;
  gradient?: boolean;
  background?: string;
  density?: number;
  particleSize?: number;
  shape?: "square" | "circle";
  entrance?: "noise" | "explode" | "rain" | "none";
  duration?: number;
  interaction?: "repel" | "attract" | "swirl" | "none";
  radius?: number;
  force?: number;
  idle?: boolean;
  replay?: "none" | "hover" | "click" | "scroll";
  style?: React.CSSProperties;
  className?: string;
};

function parseRGBA(c?: string): [number, number, number, number] | null {
  const m = c && c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((v) => parseFloat(v));
  if (p.length < 3 || p.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  return [p[0], p[1], p[2], Number.isFinite(p[3]) ? p[3] : 1];
}

function parseHex(c?: string): [number, number, number, number] | null {
  const m = c && c.match(/#([0-9a-f]{3,8})\b/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const n = parseInt(h.slice(0, 6), 16);
  return [
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255,
    h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ];
}

function resolveColor(c: string | undefined, host: HTMLElement | null): [number, number, number, number] {
  if (host && c) {
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = c;
    host.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    const out = parseRGBA(computed);
    host.removeChild(probe);
    if (out) return out;
  }
  return parseRGBA(c) || parseHex(c) || [255, 255, 255, 1];
}

const mix = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
) =>
  `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(
    a[1] + (b[1] - a[1]) * t
  )},${Math.round(a[2] + (b[2] - a[2]) * t)},${a[3] + (b[3] - a[3]) * t})`;

type Particle = {
  tx: number;
  ty: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  ph: number;
  g: number;
};

export default function ParticleText({
  text = "TRACECARD",
  font,
  color = "#FFFFFF",
  color2 = "#FF654C",
  gradient = true,
  background = "transparent",
  density = 1,
  particleSize = 2.2,
  shape = "square",
  entrance = "noise",
  duration = 2.4,
  interaction = "repel",
  radius = 90,
  force = 6,
  idle = true,
  replay = "none",
  style,
  className,
}: ParticleTextProps) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const redraw = useRef<() => void>(() => {});
  const [replayKey, setReplayKey] = useState(0);
  const [, startTransition] = useTransition();

  const live = useRef({
    color,
    color2,
    gradient,
    radius,
    force,
    idle,
    interaction,
    shape,
    particleSize,
  });
  live.current = {
    color,
    color2,
    gradient,
    radius,
    force,
    idle,
    interaction,
    shape,
    particleSize,
  };

  useEffect(() => {
    const cvsEl = canvas.current;
    const boxEl = wrap.current;
    if (!cvsEl || !boxEl) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const ctxEl = cvsEl.getContext("2d");
    if (!ctxEl) return;

    const cvs: HTMLCanvasElement = cvsEl;
    const box: HTMLDivElement = boxEl;
    const ctx: CanvasRenderingContext2D = ctxEl;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let alive = true;
    let sizeRetryRaf = 0;
    let sizeRetryCount = 0;
    let fontReadyTimeout = 0;
    let P: Particle[] = [];
    let colorKey = "";
    let palette: string[] = [];
    const mouse = { x: -9999, y: -9999, down: false };
    let t0 = performance.now();

    const fam = (font && font.fontFamily) || "var(--font-display), 'Manrope', 'DM Sans', sans-serif";
    const weight = (font && font.fontWeight) || 800;
    const italic = font && font.fontStyle === "italic" ? "italic " : "";
    const lines = String(text || "TRACECARD").split("\n");

    function readAxis(value: unknown, fallback: number): number {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
      if (typeof value === "string") {
        const n = parseFloat(value);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return fallback;
    }

    function resolveSize() {
      const rect = box?.getBoundingClientRect();
      const s = style || {};
      const fromStyleW = readAxis(s.width, 900);
      const fromStyleH = readAxis(s.height, 220);
      const cw = box?.clientWidth || 0;
      const ch = box?.clientHeight || 0;
      const rw = rect?.width || 0;
      const rh = rect?.height || 0;
      const width = Math.max(0, cw || rw || fromStyleW || 900);
      const height = Math.max(0, ch || rh || fromStyleH || 220);
      return { width, height };
    }

    function sample(): [number, number][] {
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.floor(W));
      off.height = Math.max(1, Math.floor(H));
      const o = off.getContext("2d");
      if (!o) return [];

      let fs = H / (lines.length * 1.15);
      o.font = `${italic}${weight} ${fs}px ${fam}`;
      const widest = Math.max(...lines.map((l) => o.measureText(l).width), 1);
      fs = Math.min(fs, (fs * W * 0.94) / widest);
      o.font = `${italic}${weight} ${fs}px ${fam}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillStyle = "#000";

      const lh = fs * 1.05;
      lines.forEach((l, i) =>
        o.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh)
      );

      let data: Uint8ClampedArray;
      try {
        data = o.getImageData(0, 0, off.width, off.height).data;
      } catch {
        return [];
      }

      const ow = off.width;
      const ink = (x: number, y: number) =>
        data[(Math.floor(y) * ow + Math.floor(x)) * 4 + 3] > 120;

      let n = 0;
      for (let y = 0; y < off.height; y += 2) {
        for (let x = 0; x < ow; x += 2) {
          if (ink(x, y)) n++;
        }
      }
      const area = n * 4;
      const budget = (W < 600 ? 3200 : 8000) * density;
      const gap = Math.max(1.6, Math.sqrt(area / Math.max(1, budget)));
      const pts: [number, number][] = [];

      for (let y = gap / 2; y < off.height; y += gap) {
        for (let x = gap / 2; x < ow; x += gap) {
          const jx = Math.min(ow - 1, Math.max(0, x + (Math.random() - 0.5) * gap * 0.9));
          const jy = Math.min(off.height - 1, Math.max(0, y + (Math.random() - 0.5) * gap * 0.9));
          if (ink(jx, jy)) pts.push([jx, jy]);
        }
      }
      return pts;
    }

    function start(x: number, y: number): [number, number] {
      if (reduce || entrance === "none") return [x, y];
      if (entrance === "explode")
        return [W / 2 + (Math.random() - 0.5) * 40, H / 2 + (Math.random() - 0.5) * 40];
      if (entrance === "rain")
        return [x + (Math.random() - 0.5) * 60, -Math.random() * H - 40];
      return [Math.random() * W, Math.random() * H];
    }

    function build() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = resolveSize();
      W = size.width;
      H = size.height;
      cvs.width = Math.max(1, W * dpr);
      cvs.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (W < 2 || H < 2) {
        P = [];
        return false;
      }

      P = sample()
        .map(([x, y]) => {
          const [sx, sy] = start(x, y);
          return {
            tx: x,
            ty: y,
            x: sx,
            y: sy,
            vx: 0,
            vy: 0,
            s: Math.random() * 0.7 + 0.65,
            ph: Math.random() * Math.PI * 2,
            g: Math.min(31, Math.floor((x / Math.max(1, W)) * 32)),
          };
        })
        .sort((a, b) => a.g - b.g);

      if (P.length === 0) {
        const [sx, sy] = start(W / 2, H / 2);
        P = [
          {
            tx: W / 2,
            ty: H / 2,
            x: sx,
            y: sy,
            vx: 0,
            vy: 0,
            s: 1,
            ph: Math.random() * Math.PI * 2,
            g: 16,
          },
        ];
      }

      colorKey = "";
      t0 = performance.now();
      return true;
    }

    function frame() {
      raf = 0;
      if (!alive) return;
      const L = live.current;
      const key = `${L.color}|${L.color2}|${L.gradient}`;
      if (key !== colorKey) {
        colorKey = key;
        const c1 = resolveColor(L.color, box);
        const c2 = L.gradient ? resolveColor(L.color2, box) : c1;
        palette = Array.from({ length: 32 }, (_, i) => mix(c1, c2, i / 31));
      }

      let lastG = -1;
      const t = (performance.now() - t0) / 1000;
      const k = reduce ? 1 : Math.min(1, t / Math.max(0.3, duration));
      const ease = 1 - Math.pow(1 - k, 3);
      ctx.clearRect(0, 0, W, H);

      const R = L.radius;
      const R2 = R * R;
      const size = L.particleSize;

      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const amp = (1 - ease) * 30 + (L.idle && !reduce ? 1.2 : 0);
        const nx = Math.sin(p.ph + t * 1.4) * amp;
        const ny = Math.cos(p.ph * 1.3 + t * 1.1) * amp;

        p.vx += (p.tx + nx - p.x) * (0.03 + 0.04 * ease);
        p.vy += (p.ty + ny - p.y) * (0.03 + 0.04 * ease);

        if (L.interaction !== "none") {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const d = Math.sqrt(d2) || 1;
            const f = ((R2 - d2) / R2) * L.force * (mouse.down ? 2 : 1);
            const dir = L.interaction === "attract" ? -1 : 1;
            if (L.interaction === "swirl") {
              p.vx += (-dy / d) * f;
              p.vy += (dx / d) * f;
            } else {
              p.vx += (dx / d) * f * dir;
              p.vy += (dy / d) * f * dir;
            }
          }
        }

        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;

        const sp = Math.min(1, Math.abs(p.vx) + Math.abs(p.vy));
        if (p.g !== lastG) {
          lastG = p.g;
          ctx.fillStyle = palette[p.g];
        }

        ctx.globalAlpha = 0.55 + 0.45 * (1 - sp * 0.5);
        const s = size * p.s * (1 + sp * 0.5);

        if (L.shape === "circle") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }

      ctx.globalAlpha = 1;
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    }

    redraw.current = () => {
      if (alive && !raf && P.length) frame();
    };

    const go = () => {
      if (!alive) return;
      const ok = build();
      frame();
      if (!ok && sizeRetryCount < 20) {
        sizeRetryCount += 1;
        if (sizeRetryRaf) cancelAnimationFrame(sizeRetryRaf);
        sizeRetryRaf = requestAnimationFrame(go);
      } else {
        sizeRetryCount = 0;
      }
    };

    const fontStr = `${italic}${weight} 64px ${fam}`;
    let initialStarted = false;
    const startInitial = () => {
      if (initialStarted || !alive) return;
      initialStarted = true;
      go();
    };

    fontReadyTimeout = window.setTimeout(startInitial, 800);
    if (document.fonts?.load) {
      document.fonts.load(fontStr).then(startInitial).catch(startInitial);
    } else {
      startInitial();
    }

    let rt = 0;
    const ro = new ResizeObserver(() => {
      if (!initialStarted) return;
      clearTimeout(rt);
      rt = window.setTimeout(go, 120);
    });
    ro.observe(box);

    let hasScrolledIntoView = false;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      visible = entry.isIntersecting;
      if (visible) {
        if (replay === "scroll" && !hasScrolledIntoView) {
          hasScrolledIntoView = true;
          t0 = performance.now();
        }
        if (!raf) frame();
      } else {
        if (replay === "scroll") {
          hasScrolledIntoView = false;
        }
      }
    }, { threshold: 0.15 });
    io.observe(box);

    const move = (e: PointerEvent) => {
      const r = cvs.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const leave = () => {
      mouse.x = mouse.y = -9999;
      mouse.down = false;
    };
    const down = () => {
      mouse.down = true;
    };
    const up = () => {
      mouse.down = false;
    };

    box.addEventListener("pointermove", move);
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointerleave", leave);

    return () => {
      alive = false;
      redraw.current = () => {};
      cancelAnimationFrame(raf);
      cancelAnimationFrame(sizeRetryRaf);
      clearTimeout(fontReadyTimeout);
      clearTimeout(rt);
      ro.disconnect();
      io.disconnect();
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointerleave", leave);
    };
  }, [
    text,
    font,
    density,
    entrance,
    duration,
    replayKey,
    replay,
    style,
  ]);

  useEffect(() => {
    redraw.current();
  }, [color, color2, gradient, particleSize, shape]);

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={String(text || "").replace(/\n/g, " ")}
      className={className}
      onClick={
        replay === "click"
          ? () => startTransition(() => setReplayKey((k) => k + 1))
          : undefined
      }
      onMouseEnter={
        replay === "hover"
          ? () => startTransition(() => setReplayKey((k) => k + 1))
          : undefined
      }
      style={{
        ...style,
        position: "relative",
        width: "100%",
        background,
        overflow: "hidden",
        touchAction: interaction === "none" ? "auto" : "pan-y",
        cursor: replay === "click" ? "pointer" : "default",
      }}
    >
      <canvas
        ref={canvas}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
