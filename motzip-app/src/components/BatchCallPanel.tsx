"use client";

import { useEffect, useRef, useState } from "react";
import { Restaurant, categoryEmoji } from "@/types/restaurant";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

type CallPhase = "idle" | "calling" | "done" | "error";

interface CallResult {
  can_reserve: boolean | null;
  wait_minutes: number | null;
  notes: string;
  raw_speech: string;
}

interface CardState {
  selected: boolean;
  phase: CallPhase;
  result: CallResult | null;
  error: string;
}

type Mode = "sequential" | "parallel";

interface Props {
  restaurants: Restaurant[];
  onClose: () => void;
}

const initialState = (): CardState => ({
  selected: false,
  phase: "idle",
  result: null,
  error: "",
});

export default function BatchCallPanel({ restaurants, onClose }: Props) {
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [mode, setMode] = useState<Mode>("sequential");
  const [globalQuestion, setGlobalQuestion] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const cancelRef = useRef(false);

  // Reset card states when the restaurant list changes (new search).
  // Guard against parent passing same content with new array reference.
  useEffect(() => {
    setStates((prev) => {
      const prevIds = Object.keys(prev).sort().join(",");
      const newIds = restaurants.map((r) => r.id).sort().join(",");
      if (prevIds === newIds) return prev;
      return Object.fromEntries(restaurants.map((r) => [r.id, initialState()]));
    });
    setBatchRunning(false);
    cancelRef.current = false;
  }, [restaurants]);

  // Stop in-flight polling on unmount
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);

  const updateCard = (id: string, patch: Partial<CardState>) => {
    setStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? initialState()), ...patch } }));
  };

  const toggleSelect = (id: string) => {
    setStates((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? initialState()), selected: !prev[id]?.selected },
    }));
  };

  const callable = restaurants.filter((r) => !!r.phone);
  const selectedIds = callable.filter((r) => states[r.id]?.selected).map((r) => r.id);
  const allCallableSelected =
    callable.length > 0 && callable.every((r) => states[r.id]?.selected);

  const toggleAll = () => {
    const newVal = !allCallableSelected;
    setStates((prev) => {
      const next = { ...prev };
      for (const r of callable) {
        next[r.id] = { ...(next[r.id] ?? initialState()), selected: newVal };
      }
      return next;
    });
  };

  const runOneCall = async (restaurant: Restaurant) => {
    if (!restaurant.phone) return;
    updateCard(restaurant.id, { phase: "calling", result: null, error: "" });

    try {
      const res = await fetch(`${SERVER_URL}/api/call-restaurant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurant_name: restaurant.name,
          phone: restaurant.phone,
          party_size: 2,
          time_preference: "as soon as possible",
          custom_question: globalQuestion.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { call_sid } = await res.json();

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (cancelRef.current) return;
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await fetch(`${SERVER_URL}/api/call-result/${call_sid}`);
        if (!poll.ok) continue;
        const data = await poll.json();
        if (data.status === "completed") {
          updateCard(restaurant.id, { phase: "done", result: data });
          return;
        }
        if (["failed", "busy", "no-answer", "canceled"].includes(data.status)) {
          updateCard(restaurant.id, { phase: "error", error: `Call failed: ${data.status}` });
          return;
        }
      }
      updateCard(restaurant.id, { phase: "error", error: "Response timed out" });
    } catch (e) {
      updateCard(restaurant.id, {
        phase: "error",
        error: e instanceof Error ? e.message : "Error occurred",
      });
    }
  };

  const runBatch = async () => {
    if (selectedIds.length === 0 || batchRunning) return;
    setBatchRunning(true);
    cancelRef.current = false;

    const queue = restaurants.filter((r) => selectedIds.includes(r.id));

    // Fake-parallel: visually mark all selected as "calling" up front,
    // even though we still dial them sequentially under the hood.
    if (mode === "parallel") {
      setStates((prev) => {
        const next = { ...prev };
        for (const r of queue) {
          next[r.id] = {
            ...(next[r.id] ?? initialState()),
            phase: "calling",
            result: null,
            error: "",
          };
        }
        return next;
      });
    }

    for (const r of queue) {
      if (cancelRef.current) break;
      await runOneCall(r);
    }

    setBatchRunning(false);
  };

  return (
    <div className="absolute right-3 top-3 bottom-3 w-[380px] z-30 animate-slide-in">
      <div className="h-full bg-gray-950/85 backdrop-blur-2xl rounded-3xl border border-white/[0.06] text-white flex flex-col overflow-hidden shadow-2xl shadow-black/50">
        <div className="h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />

        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-gray-500 hover:text-white transition-all text-sm"
          >
            ✕
          </button>
          <h2 className="text-base font-bold leading-tight">{restaurants.length} results</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{callable.length} callable</p>
        </div>

        {/* Controls */}
        <div className="px-5 pb-3 space-y-2.5 border-b border-white/[0.04]">
          <input
            type="text"
            value={globalQuestion}
            onChange={(e) => setGlobalQuestion(e.target.value)}
            placeholder="Extra question (e.g. any tables right now?)"
            disabled={batchRunning}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              Mode
            </span>
            <div className="flex bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.05]">
              <button
                onClick={() => setMode("sequential")}
                disabled={batchRunning}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
                  mode === "sequential"
                    ? "bg-violet-700/60 text-white"
                    : "text-gray-500 hover:text-gray-300"
                } disabled:opacity-50`}
              >
                Sequential
              </button>
              <button
                onClick={() => setMode("parallel")}
                disabled={batchRunning}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
                  mode === "parallel"
                    ? "bg-violet-700/60 text-white"
                    : "text-gray-500 hover:text-gray-300"
                } disabled:opacity-50`}
              >
                Parallel
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAll}
              disabled={callable.length === 0 || batchRunning}
              className="text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.04] disabled:opacity-30 transition"
            >
              {allCallableSelected ? "Deselect all" : "Select all"}
            </button>
            <button
              onClick={runBatch}
              disabled={selectedIds.length === 0 || batchRunning}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold transition-all bg-violet-900/50 border border-violet-500/20 text-violet-300 hover:bg-violet-800/50 hover:text-violet-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {batchRunning ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Calling in progress...
                </>
              ) : (
                <>📞 Call {selectedIds.length} selected</>
              )}
            </button>
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {restaurants.map((r) => {
            const s = states[r.id] ?? initialState();
            const hasPhone = !!r.phone;
            return (
              <div
                key={r.id}
                className={`rounded-2xl border transition-colors ${
                  s.selected
                    ? "bg-violet-900/15 border-violet-500/25"
                    : "bg-white/[0.02] border-white/[0.04]"
                } ${!hasPhone ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-3 p-3">
                  <button
                    onClick={() => hasPhone && toggleSelect(r.id)}
                    disabled={!hasPhone || batchRunning}
                    className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                      s.selected
                        ? "bg-violet-500 border-violet-500 text-white"
                        : "border-white/20 hover:border-violet-400/60"
                    } ${!hasPhone || batchRunning ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {s.selected && (
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg leading-none">
                        {categoryEmoji[r.category]}
                      </span>
                      <span className="text-[13px] font-semibold text-white truncate">
                        {r.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                      <span className="text-amber-400">★</span>
                      <span>{r.rating.toFixed(1)}</span>
                      <span className="text-gray-700">·</span>
                      <span>{r.reviewCount} reviews</span>
                      {!hasPhone && (
                        <span className="text-gray-600 ml-auto">No phone</span>
                      )}
                    </div>

                    {s.phase === "calling" && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-violet-300">
                        <svg
                          className="w-3 h-3 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                        Calling...
                      </div>
                    )}

                    {s.phase === "error" && (
                      <p className="mt-2 text-[11px] text-rose-400">{s.error}</p>
                    )}

                    {s.phase === "done" && s.result && (
                      <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/[0.05] p-2.5 space-y-1 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              s.result.can_reserve === true
                                ? "bg-emerald-400"
                                : s.result.can_reserve === false
                                ? "bg-rose-400"
                                : "bg-gray-500"
                            }`}
                          />
                          <span className="text-gray-300 font-medium">
                            {s.result.can_reserve === true
                              ? "Reservation available"
                              : s.result.can_reserve === false
                              ? "Walk-in only"
                              : "Status unclear"}
                          </span>
                          {s.result.wait_minutes != null && s.result.wait_minutes > 0 && (
                            <span className="ml-auto text-amber-300 font-semibold">
                              ~{s.result.wait_minutes} min
                            </span>
                          )}
                          {s.result.wait_minutes === 0 && s.result.can_reserve && (
                            <span className="ml-auto text-emerald-300 font-semibold">
                              No wait
                            </span>
                          )}
                        </div>
                        {s.result.notes && (
                          <p className="text-gray-400 leading-relaxed line-clamp-3">
                            {s.result.notes}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
      </div>
    </div>
  );
}
