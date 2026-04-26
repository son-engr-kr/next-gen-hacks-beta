"use client";

import { useEffect, useRef, useState } from "react";
import { Restaurant } from "@/types/restaurant";
import {
  CallResult,
  TERMINAL_FAILURES,
  fetchCallResult,
  initiateCall,
} from "@/lib/callApi";
import BatchCallControls, { Mode } from "./batch-call/BatchCallControls";
import RestaurantCallCard, {
  CardState,
  CallPhase,
} from "./batch-call/RestaurantCallCard";

interface Props {
  restaurants: Restaurant[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onClose: () => void;
}

const initialState = (): CardState => ({
  phase: "idle",
  result: null,
  error: "",
  progress: "",
});

const POLL_INTERVAL_MS = 3000;
const POLL_DEADLINE_MS = 240_000; // 4 min — fits multi-question conversations

export default function BatchCallPanel({
  restaurants,
  selectedIds,
  onToggleSelection,
  onClose,
}: Props) {
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [mode, setMode] = useState<Mode>("sequential");
  const [globalQuestion, setGlobalQuestion] = useState("");
  const [askedKeys, setAskedKeys] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const cancelRef = useRef(false);

  // Reset card states when the restaurant list itself changes (new search).
  // Guard against parent passing same content with a new array reference.
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

  // Stop in-flight polling on unmount (e.g. user closes the panel mid-batch).
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);

  const updateCard = (id: string, patch: Partial<CardState>) => {
    setStates((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? initialState()), ...patch },
    }));
  };

  const toggleQuestionKey = (key: string) => {
    setAskedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const callable = restaurants.filter((r) => !!r.phone);
  const selectedCallable = callable.filter((r) => selectedIds.has(r.id));
  const allCallableSelected =
    callable.length > 0 && callable.every((r) => selectedIds.has(r.id));

  const toggleAll = () => {
    const turnOn = !allCallableSelected;
    for (const r of callable) {
      const isSelected = selectedIds.has(r.id);
      if (turnOn !== isSelected) onToggleSelection(r.id);
    }
  };

  const setCallingPhase = (id: string) =>
    updateCard(id, { phase: "calling" as CallPhase, result: null, error: "", progress: "" });

  const runOneCall = async (restaurant: Restaurant) => {
    if (!restaurant.phone) return;
    setCallingPhase(restaurant.id);

    try {
      // If the user didn't pick a question or write one, default to asking
      // about reservation/wait — the most common single thing people call to
      // find out — so the agent always has something concrete to ask.
      const customQ = globalQuestion.trim();
      const questions = askedKeys.size === 0 && !customQ
        ? ["reservation"]
        : Array.from(askedKeys);

      const { call_sid } = await initiateCall({
        restaurant_name: restaurant.name,
        phone: restaurant.phone,
        questions,
        custom_question: customQ,
      });

      const deadline = Date.now() + POLL_DEADLINE_MS;
      while (Date.now() < deadline) {
        if (cancelRef.current) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const data: CallResult | null = await fetchCallResult(call_sid);
        if (!data) continue;

        // Stream partial answers + progress while the call is going.
        const partial: Partial<CardState> = {};
        if (data.answers && Object.keys(data.answers).length > 0) {
          partial.result = data;
        }
        if (typeof data.status === "string" && data.status.startsWith("asking")) {
          partial.progress = data.status;
        }
        if (Object.keys(partial).length > 0) updateCard(restaurant.id, partial);

        if (data.status === "completed") {
          updateCard(restaurant.id, { phase: "done", result: data, progress: "" });
          return;
        }
        if (TERMINAL_FAILURES.includes(data.status)) {
          updateCard(restaurant.id, {
            phase: "error",
            error: `Call failed: ${data.status}`,
          });
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
    if (selectedCallable.length === 0 || batchRunning) return;
    setBatchRunning(true);
    cancelRef.current = false;

    // Fake-parallel: visually mark all selected as "calling" up front, even
    // though we still dial them sequentially under the hood (single phone).
    if (mode === "parallel") {
      setStates((prev) => {
        const next = { ...prev };
        for (const r of selectedCallable) {
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

    for (const r of selectedCallable) {
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

        <BatchCallControls
          askedKeys={askedKeys}
          onToggleQuestionKey={toggleQuestionKey}
          globalQuestion={globalQuestion}
          onGlobalQuestionChange={setGlobalQuestion}
          mode={mode}
          onModeChange={setMode}
          allCallableSelected={allCallableSelected}
          onToggleAll={toggleAll}
          selectedCount={selectedCallable.length}
          callableCount={callable.length}
          batchRunning={batchRunning}
          onRunBatch={runBatch}
        />

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {restaurants.map((r) => (
            <RestaurantCallCard
              key={r.id}
              restaurant={r}
              state={states[r.id] ?? initialState()}
              selected={selectedIds.has(r.id)}
              batchRunning={batchRunning}
              onToggleSelection={onToggleSelection}
            />
          ))}
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
      </div>
    </div>
  );
}
