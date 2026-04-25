"use client";

import { QUESTION_CATALOG } from "@/lib/questionCatalog";

interface Props {
  askedKeys: Set<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}

/** Pill-style multi-select for the structured questions to ask on the call. */
export default function QuestionChecklist({ askedKeys, onToggle, disabled }: Props) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1.5">
        What to ask
      </p>
      <div className="flex flex-wrap gap-1.5">
        {QUESTION_CATALOG.map((q) => {
          const checked = askedKeys.has(q.key);
          return (
            <button
              key={q.key}
              onClick={() => onToggle(q.key)}
              disabled={disabled}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1 ${
                checked
                  ? "bg-violet-700/40 border-violet-500/40 text-violet-100"
                  : "bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-gray-200 hover:border-white/[0.15]"
              } disabled:opacity-50`}
            >
              <span
                className={`w-3 h-3 rounded border flex items-center justify-center ${
                  checked ? "bg-violet-500 border-violet-500" : "border-white/20"
                }`}
              >
                {checked && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
