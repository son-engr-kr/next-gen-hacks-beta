"use client";

import dynamic from "next/dynamic";

const Map3D = dynamic(() => import("@/components/Map3D"), { ssr: false });

export default function Home() {
  return (
    <div className="w-full h-screen flex flex-col bg-gray-950">
      {/* Floating header - glassmorphism */}
      <header className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Logo pill */}
          <div className="pointer-events-auto flex items-center gap-2.5 bg-gray-950/70 backdrop-blur-xl rounded-2xl px-4 py-2 border border-white/[0.06] shadow-2xl shadow-black/40">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <span className="text-sm font-black text-white leading-none">M</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">
                MOTZIP
              </h1>
              <p className="text-[9px] text-gray-500 font-medium tracking-wider leading-none mt-0.5">
                3D RESTAURANT MAP
              </p>
            </div>
          </div>

          {/* Controls hint */}
          <div className="pointer-events-auto flex items-center gap-1.5 bg-gray-950/70 backdrop-blur-xl rounded-xl px-3 py-1.5 border border-white/[0.06]">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300 font-mono">Drag</kbd>
              <span>pan</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300 font-mono">Right</kbd>
              <span>rotate</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-300 font-mono">Scroll</kbd>
              <span>zoom</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 relative">
        <Map3D />
      </main>
    </div>
  );
}
