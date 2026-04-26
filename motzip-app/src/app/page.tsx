"use client";

import dynamic from "next/dynamic";

const Map3D = dynamic(() => import("@/components/Map3D"), { ssr: false });

export default function Home() {
  return (
    <div className="w-full h-screen flex flex-col bg-gray-950">
      <main className="flex-1 relative">
        <Map3D />
      </main>
    </div>
  );
}
