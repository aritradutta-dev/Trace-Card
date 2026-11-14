"use client";

import { useEffect, useRef } from "react";

type Dot = {
  x: number;
  y: number;
  inclination: number;
  ascension: number;
  phase: number;
  speed: number;
};

/** A lightweight local adaptation of the supplied Framer dot-grid background. */
export default function DotGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    const targetCanvas = canvas as HTMLCanvasElement;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const spacing = 36;
    const pointer = { x: -9999, y: -9999, active: false, leftAt: 0 };
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let angle = 0;
    let lastTime = 0;
    let frame = 0;
    let running = false;

    const ease = (value: number) => {
      const t = Math.max(0, Math.min(1, value));
      return t * t * (3 - 2 * t);
    };

    function buildDots() {
      const columns = Math.ceil(width / spacing) + 2;
      const rows = Math.ceil(height / spacing) + 2;
      dots = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          dots.push({
            x: column * spacing,
            y: row * spacing,
            inclination: Math.random() * Math.PI,
            ascension: Math.random() * Math.PI * 2,
            phase: Math.random() * Math.PI * 2,
            speed: 0.7 + Math.random() * 0.6,
          });
        }
      }
    }

    function draw(time: number) {
      if (!context) return;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      angle += 1.15 * delta;
      context.clearRect(0, 0, width, height);

      const decay = pointer.active
        ? 1
        : ease(Math.max(0, 1 - Math.max(0, time - pointer.leftAt) / 1000 * 1.5));

      for (const dot of dots) {
        const dx = dot.x - pointer.x;
        const dy = dot.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        const nearby = distance > 0 && distance < 120;
        let x = dot.x;
        let y = dot.y;
        let size = 1;
        let alpha = 0.28;

        if (nearby) {
          const influence = ease(1 - distance / 120) * decay;
          const radius = (1 - distance / 120) * spacing * 0.7 * influence;
          const theta = angle * dot.speed + dot.phase;
          const cosA = Math.cos(dot.ascension);
          const sinA = Math.sin(dot.ascension);
          const cosI = Math.cos(dot.inclination);
          const sinI = Math.sin(dot.inclination);
          const localX = Math.cos(theta);
          const localY = Math.sin(theta) * cosI;
          const depth = Math.sin(theta) * sinI;
          x += (localX * cosA - localY * sinA) * radius;
          y += (localX * sinA + localY * cosA) * radius;
          const depthScale = 0.75 + 0.25 * ((depth + 1) * 0.5);
          size = (1 + 0.75 * influence) * depthScale;
          alpha = (0.28 + 0.58 * influence) * depthScale;
        }

        context.beginPath();
        context.arc(x, y, 1.65 * size, 0, Math.PI * 2);
        context.fillStyle = `rgba(212, 238, 141, ${alpha})`;
        context.fill();
      }
    }

    function animate(time: number) {
      if (!running || document.hidden) return;
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function resize() {
      const bounds = targetCanvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.25);
      targetCanvas.width = Math.round(width * ratio);
      targetCanvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildDots();
      draw(performance.now());
    }

    function start() {
      if (document.hidden) return;
      if (reducedMotion.matches) {
        draw(performance.now());
        return;
      }
      if (running) return;
      running = true;
      lastTime = 0;
      frame = window.requestAnimationFrame(animate);
    }

    function stop() {
      running = false;
      window.cancelAnimationFrame(frame);
    }

    function onPointerMove(event: PointerEvent) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    }

    function onPointerLeave() {
      pointer.x = -9999;
      pointer.y = -9999;
      pointer.active = false;
      pointer.leftAt = performance.now();
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }

    function onMotionChange() {
      if (reducedMotion.matches) {
        stop();
        draw(performance.now());
      } else start();
    }

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(targetCanvas);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener?.("change", onMotionChange);
    resize();
    start();

    return () => {
      stop();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onPointerLeave);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener?.("change", onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="dot-grid-background" aria-hidden="true" />;
}
