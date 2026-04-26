"use client";

import QuestionChecklist from "./QuestionChecklist";

export type Mode = "sequential" | "parallel";

interface Props {
  // Question selection
  askedKeys: Set<string>;
  onToggleQuestionKey: (key: string) => void;
  globalQuestion: string;
  onGlobalQuestionChange: (v: string) => void;

  // Mode + selection actions
  mode: Mode;
  onModeChange: (m: Mode) => void;
  allCallableSelected: boolean;
  onToggleAll: () => void;

  // Call action
  selectedCount: number;
  callableCount: number;
  batchRunning: boolean;
  onRunBatch: () => void;
}

/** Top section of the batch panel: question checklist, mode toggle, action buttons. */
export default function BatchCallControls({
  askedKeys,
  onToggleQuestionKey,
  globalQuestion,
  onGlobalQuestionChange,
  mode,
  onModeChange,
  allCallableSelected,
  onToggleAll,
  selectedCount,
  callableCount,
  batchRunning,
  onRunBatch,
}: Props) {
  // No question picked? We default to the reservation question at call time
  // (handled in BatchCallPanel.runOneCall), so the button stays enabled.
  const callDisabled = selectedCount === 0 || batchRunning;

  return (
    <div className="px-5 pb-3 space-y-2.5 border-b border-white/[0.04]">
      <QuestionChecklist
        askedKeys={askedKeys}
        onToggle={onToggleQuestionKey}
        disabled={batchRunning}
      />

      <input
        type="text"
        value={globalQuestion}
        onChange={(e) => onGlobalQuestionChange(e.target.value)}
        placeholder="Or write a custom question..."
        disabled={batchRunning}
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50"
      />

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
          Mode
        </span>
        <div className="flex bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.05]">
          <button
            onClick={() => onModeChange("sequential")}
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
            onClick={() => onModeChange("parallel")}
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
          onClick={onToggleAll}
          disabled={callableCount === 0 || batchRunning}
          className="text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.04] disabled:opacity-30 transition"
        >
          {allCallableSelected ? "Deselect all" : "Select all"}
        </button>
        <button
          onClick={onRunBatch}
          disabled={callDisabled}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold transition-all bg-violet-900/50 border border-violet-500/20 text-violet-300 hover:bg-violet-800/50 hover:text-violet-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {batchRunning ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Calling in progress...
            </>
          ) : (
            <>📞 Call {selectedCount} selected</>
          )}
        </button>
      </div>
    </div>
  );
}
