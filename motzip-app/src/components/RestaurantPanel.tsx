"use client";

import { useState } from "react";
import { Restaurant, categoryEmoji } from "@/types/restaurant";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

interface Props {
  restaurant: Restaurant;
  onClose: () => void;
}

function Stars({ rating }: { rating: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) stars.push(<span key={i} className="text-amber-400">&#9733;</span>);
    else if (rating >= i - 0.5) stars.push(<span key={i} className="text-amber-400/40">&#9733;</span>);
    else stars.push(<span key={i} className="text-white/10">&#9733;</span>);
  }
  return <span className="text-sm flex gap-px">{stars}</span>;
}

function RatingBadge({ rating }: { rating: number }) {
  const color =
    rating >= 4.5
      ? "from-amber-400 to-orange-500 shadow-amber-500/25"
      : rating >= 4.0
      ? "from-orange-400 to-orange-600 shadow-orange-500/25"
      : "from-rose-400 to-red-500 shadow-red-500/25";
  return (
    <div className={`bg-gradient-to-br ${color} text-white text-2xl font-black w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl`}>
      {rating.toFixed(1)}
    </div>
  );
}

function StatCard({ value, label, gradient }: { value: string; label: string; gradient: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white/[0.03] border border-white/[0.05] p-4 text-center hover:bg-white/[0.05] transition-colors">
      <p className={`text-2xl font-black bg-gradient-to-r ${gradient} bg-clip-text text-transparent`}>
        {value}
      </p>
      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest font-semibold">{label}</p>
    </div>
  );
}

type CallPhase = "idle" | "calling" | "done" | "error";

interface CallResult {
  can_reserve: boolean | null;
  wait_minutes: number | null;
  notes: string;
  raw_speech: string;
}

export default function RestaurantPanel({ restaurant, onClose }: Props) {
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const [callResult, setCallResult] = useState<CallResult | null>(null);
  const [callError, setCallError] = useState("");

  const handleCall = async () => {
    if (!restaurant.phone) return;
    setCallPhase("calling");
    setCallResult(null);
    setCallError("");

    try {
      // Initiate call
      const res = await fetch(`${SERVER_URL}/api/call-restaurant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_name: restaurant.name,
          phone: restaurant.phone,
          party_size: 2,
          time_preference: "as soon as possible",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { call_sid } = await res.json();

      // Poll for result (max 45s)
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await fetch(`${SERVER_URL}/api/call-result/${call_sid}`);
        if (!poll.ok) continue;
        const data = await poll.json();
        if (data.status === "completed") {
          setCallResult(data);
          setCallPhase("done");
          return;
        }
        if (["failed", "busy", "no-answer", "canceled"].includes(data.status)) {
          setCallError(`통화 실패: ${data.status}`);
          setCallPhase("error");
          return;
        }
      }
      setCallError("응답 시간 초과");
      setCallPhase("error");
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "오류 발생");
      setCallPhase("error");
    }
  };

  return (
    <div className="absolute right-3 top-3 bottom-3 w-[340px] z-30 animate-slide-in">
      <div className="h-full bg-gray-950/80 backdrop-blur-2xl rounded-3xl border border-white/[0.06] text-white flex flex-col overflow-hidden shadow-2xl shadow-black/50">
        {/* Top accent line */}
        <div className="h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-gray-500 hover:text-white transition-all text-sm"
          >
            &#x2715;
          </button>

          <div className="flex items-start gap-4">
            <div className="text-5xl">{categoryEmoji[restaurant.category]}</div>
            <div className="flex-1 min-w-0 pt-1">
              <h2 className="text-lg font-bold leading-tight truncate">{restaurant.name}</h2>
              <div className="flex items-center gap-2 mt-1.5">
                <Stars rating={restaurant.rating} />
                <span className="text-[11px] text-gray-500">{restaurant.reviewCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-5 space-y-3 flex-1 overflow-y-auto">
          {restaurant.isTrending && (
            <div className="flex items-center gap-2 bg-gradient-to-r from-orange-500/[0.08] to-rose-500/[0.08] text-orange-300 text-xs font-semibold px-3 py-2 rounded-xl border border-orange-500/10">
              <span className="animate-pulse">&#x1F525;</span>
              Trending in Boston
            </div>
          )}

          <p className="text-[13px] text-gray-400 leading-relaxed">{restaurant.description}</p>

          {restaurant.topReview && (
            <div className="relative rounded-2xl bg-white/[0.03] border border-white/[0.05] p-4">
              <div className="absolute -top-1.5 left-4 px-2 bg-gray-950/80 text-[9px] text-gray-500 uppercase tracking-widest font-bold">
                Top Review
              </div>
              <p className="text-gray-300 text-[13px] italic leading-relaxed mt-1">
                &ldquo;{restaurant.topReview}&rdquo;
              </p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <StatCard
              value={restaurant.rating.toFixed(1)}
              label="Rating"
              gradient="from-amber-300 to-orange-400"
            />
            <StatCard
              value={String(restaurant.reviewCount)}
              label="Reviews"
              gradient="from-sky-300 to-blue-400"
            />
          </div>

          {/* Twilio Call section */}
          {restaurant.phone && (
            <div className="pt-1">
              <button
                onClick={handleCall}
                disabled={callPhase === "calling"}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-semibold transition-all
                  ${callPhase === "calling"
                    ? "bg-violet-900/40 border border-violet-500/20 text-violet-400 cursor-wait"
                    : callPhase === "done"
                    ? "bg-emerald-900/40 border border-emerald-500/20 text-emerald-300"
                    : callPhase === "error"
                    ? "bg-rose-900/40 border border-rose-500/20 text-rose-300"
                    : "bg-violet-900/40 border border-violet-500/20 text-violet-300 hover:bg-violet-800/40 hover:text-violet-200"
                  }`}
              >
                {callPhase === "calling" && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                )}
                {callPhase === "idle" && <span>&#128222;</span>}
                {callPhase === "idle" && " 예약 / 대기시간 전화 문의"}
                {callPhase === "calling" && " 전화 중..."}
                {callPhase === "done" && " 통화 완료"}
                {callPhase === "error" && " 통화 실패"}
              </button>

              {callError && (
                <p className="text-rose-400 text-[11px] mt-1.5 text-center">{callError}</p>
              )}

              {callResult && (
                <div className="mt-2 rounded-2xl bg-white/[0.03] border border-white/[0.05] p-3 space-y-1.5 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${callResult.can_reserve === true ? "bg-emerald-400" : callResult.can_reserve === false ? "bg-rose-400" : "bg-gray-500"}`} />
                    <span className="text-gray-300 font-medium">
                      {callResult.can_reserve === true ? "예약 가능" : callResult.can_reserve === false ? "예약 불가 (워크인)" : "예약 정보 불명확"}
                    </span>
                    {callResult.wait_minutes != null && callResult.wait_minutes > 0 && (
                      <span className="ml-auto text-amber-300 font-semibold">~{callResult.wait_minutes}분 대기</span>
                    )}
                    {callResult.wait_minutes === 0 && callResult.can_reserve && (
                      <span className="ml-auto text-emerald-300 font-semibold">대기 없음</span>
                    )}
                  </div>
                  {callResult.notes && (
                    <p className="text-gray-400 leading-relaxed">{callResult.notes}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom accent */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
      </div>
    </div>
  );
}
