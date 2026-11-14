"use client";

import { useEffect, useRef } from "react";
import { brainMeshFaces, brainMeshVertices } from "@/components/neuralBrainMesh";

type ProjectedPoint = { x: number; y: number; z: number };


export default function NeuralBrainDecoration() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const edges: [number, number][] = [];
    const edgeLookup = new Set<string>();
    for (const [a, b, c] of brainMeshFaces) {
      for (const [start, end] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        const key = `${low}:${high}`;
        if (!edgeLookup.has(key)) {
          edgeLookup.add(key);
          edges.push([low, high]);
        }
      }
    }

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let visible = true;
    let documentVisible = !document.hidden;
    let queued = false;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let lastDraw = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      queueDraw();
    };

    const draw = (timestamp: number) => {
      context.clearRect(0, 0, width, height);

      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue("--accent").trim() || "#d4ee8d";
      const line = styles.getPropertyValue("--line").trim() || "rgba(255,255,255,.12)";
      const elapsed = reducedMotion ? 0 : timestamp * 0.000045;
      const rotation = elapsed + 0.32;
      const tilt = -0.16;
      const cosY = Math.cos(rotation);
      const sinY = Math.sin(rotation);
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);
      const scale = Math.min(width * 0.75, height * 0.83);
      const centerX = width * 0.53;
      const centerY = height * 0.49;
      const focalLength = 2.3;

      const points: ProjectedPoint[] = brainMeshVertices.map(([x, y, z]) => {
        const turnedX = x * cosY + z * sinY;
        const turnedZ = -x * sinY + z * cosY;
        const turnedY = y * cosX - turnedZ * sinX;
        const depth = y * sinX + turnedZ * cosX;
        const perspective = focalLength / (focalLength - depth);
        return {
          x: centerX + turnedX * scale * perspective,
          y: centerY - turnedY * scale * perspective,
          z: depth,
        };
      });


      const orderedFaces = [...brainMeshFaces].sort((left, right) => {
        const leftDepth = (points[left[0]].z + points[left[1]].z + points[left[2]].z) / 3;
        const rightDepth = (points[right[0]].z + points[right[1]].z + points[right[2]].z) / 3;
        return leftDepth - rightDepth;
      });
      for (const [a, b, c] of orderedFaces) {
        const pa = points[a];
        const pb = points[b];
        const pc = points[c];
        const depth = (pa.z + pb.z + pc.z) / 3;
        context.beginPath();
        context.moveTo(pa.x, pa.y);
        context.lineTo(pb.x, pb.y);
        context.lineTo(pc.x, pc.y);
        context.closePath();
        context.fillStyle = accent;
        context.globalAlpha = 0.008 + Math.max(0, depth + 0.5) * 0.012;
        context.fill();
      }

      for (const [a, b] of edges) {
        const pa = points[a];
        const pb = points[b];
        const depth = (pa.z + pb.z) * 0.5;
        context.beginPath();
        context.moveTo(pa.x, pa.y);
        context.lineTo(pb.x, pb.y);
        context.strokeStyle = accent;
        context.globalAlpha = 0.045 + Math.max(0, depth + 0.45) * 0.12;
        context.lineWidth = depth > 0.12 ? 0.8 : 0.55;
        context.stroke();
      }

      // A few restrained signal nodes and traveling pulses echo the Framer original.
      context.globalAlpha = 1;
      for (let index = 0; index < points.length; index += 13) {
        const point = points[index];
        if (point.z < -0.16) continue;
        const pulse = 0.5 + 0.5 * Math.sin(timestamp * 0.0017 + index * 1.7);
        context.beginPath();
        context.arc(point.x, point.y, 0.8 + pulse * 1.25, 0, Math.PI * 2);
        context.fillStyle = accent;
        context.globalAlpha = 0.16 + pulse * 0.3;
        context.fill();
      }

      if (!reducedMotion && edges.length) {
        for (let pulseIndex = 0; pulseIndex < 7; pulseIndex += 1) {
          const phase = (timestamp * 0.00016 + pulseIndex * 0.173) % 1;
          const [a, b] = edges[(pulseIndex * 317) % edges.length];
          const start = points[a];
          const end = points[b];
          const pulseX = start.x + (end.x - start.x) * phase;
          const pulseY = start.y + (end.y - start.y) * phase;
          context.beginPath();
          context.arc(pulseX, pulseY, 1.3, 0, Math.PI * 2);
          context.fillStyle = accent;
          context.globalAlpha = 0.72;
          context.fill();
        }
      }

      context.globalAlpha = 1;

      // Very faint orbital guides situate the brain without creating another panel.
      context.beginPath();
      context.ellipse(centerX, centerY + height * 0.025, scale * 0.57, scale * 0.19, -0.15, 0, Math.PI * 2);
      context.strokeStyle = line;
      context.lineWidth = 0.7;
      context.globalAlpha = 0.42;
      context.stroke();
      context.globalAlpha = 1;
    };

    function queueDraw() {
      if (queued || !visible || !documentVisible) return;
      queued = true;
      requestAnimationFrame((timestamp) => {
        queued = false;
        if (!visible || !documentVisible) return;
        if (!reducedMotion && timestamp - lastDraw < 32) {
          queueDraw();
          return;
        }
        lastDraw = timestamp;
        draw(timestamp);
        if (!reducedMotion) queueDraw();
      });
    }

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        queueDraw();
      }, { threshold: 0.01 })
      : null;
    observer?.observe(canvas);

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);
    if (!resizeObserver) window.addEventListener("resize", resize);
    resize();

    const updateVisibility = () => {
      documentVisible = !document.hidden;
      queueDraw();
    };
    const updateMotion = () => {
      reducedMotion = reducedMotionQuery.matches;
      queueDraw();
    };
    const themeObserver = new MutationObserver(queueDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", updateVisibility);
    reducedMotionQuery.addEventListener("change", updateMotion);

    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      reducedMotionQuery.removeEventListener("change", updateMotion);
    };
  }, []);

  return (
    <div className="neural-brain-decoration" aria-hidden="true">
      <canvas ref={canvasRef} />
      <span>MODEL / POLY BY GOOGLE · CC BY 3.0</span>
    </div>
  );
}
