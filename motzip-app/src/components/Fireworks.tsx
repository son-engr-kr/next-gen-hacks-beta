"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

interface Particle {
  originLng: number;
  originLat: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Props {
  map: maplibregl.Map | null;
  lngLats: { lng: number; lat: number }[];
}

const COLORS = ["#FFD700", "#FF6347", "#FF4500", "#FFA500", "#FF69B4", "#00BFFF"];
const BURST_INTERVAL_MS = 1400;
const BURST_OFFSET_Y = -40;

export default function Fireworks({ map, lngLats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number>(0);
  const lngLatsRef = useRef(lngLats);

  useEffect(() => {
    lngLatsRef.current = lngLats;
  }, [lngLats]);

  useEffect(() => {
    if (!map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    map.on("resize", resize);

    let lastBurst = 0;

    const spawnBurst = (lng: number, lat: number) => {
      const count = 28 + Math.floor(Math.random() * 14);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
        const speed = 1.8 + Math.random() * 3.2;
        const life = 50 + Math.random() * 40;
        particlesRef.current.push({
          originLng: lng,
          originLat: lat,
          dx: 0,
          dy: BURST_OFFSET_Y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          maxLife: life,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          size: 2 + Math.random() * 2,
        });
      }
    };

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      const now = Date.now();
      const targets = lngLatsRef.current;
      if (now - lastBurst > BURST_INTERVAL_MS && targets.length > 0) {
        const t = targets[Math.floor(Math.random() * targets.length)];
        spawnBurst(t.lng, t.lat);
        lastBurst = now;
      }

      ctx.globalCompositeOperation = "lighter";

      for (const p of particlesRef.current) {
        p.dx += p.vx;
        p.dy += p.vy;
        p.vy += 0.04;
        p.life--;

        const origin = map.project([p.originLng, p.originLat]);
        const x = origin.x + p.dx;
        const y = origin.y + p.dy;
        if (x < -50 || x > w + 50 || y < -50 || y > h + 50) continue;

        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.1, p.size * alpha), 0, Math.PI * 2);
        ctx.fill();
      }

      particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
    };

    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
      map.off("resize", resize);
    };
  }, [map]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    />
  );
}
