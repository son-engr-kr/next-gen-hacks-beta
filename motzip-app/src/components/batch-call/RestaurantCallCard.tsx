"use client";

import { useEffect, useRef, useState } from "react";
import { Restaurant, categoryEmoji } from "@/types/restaurant";
import { CallResult, QuestionAnswer, fetchSignatureDishes } from "@/lib/callApi";
import { QUESTION_LABEL_MAP } from "@/lib/questionCatalog";

export type CallPhase = "idle" | "calling" | "done" | "error";

export interface CardState {
  phase: CallPhase;
  result: CallResult | null;
  error: string;
  progress: string; // e.g. "asking 2/4"
}

interface Props {
  restaurant: Restaurant;
  state: CardState;
  selected: boolean;
  batchRunning: boolean;
  onToggleSelection: (id: string) => void;
}

/** A single restaurant row in the batch panel: checkbox, info, live call status,
 *  per-question answer checklist. Click anywhere on the body (NOT the checkbox)
 *  to expand a details drawer with description, top review, and feature badges. */
export default function RestaurantCallCard({
  restaurant: r,
  state: s,
  selected,
  batchRunning,
  onToggleSelection,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  // Per-card cache of signature dishes. null = not yet fetched, [] = fetched (no
  // dishes), [...] = fetched results. Refreshing is unnecessary since the
  // server caches results too.
  const [dishes, setDishes] = useState<string[] | null>(null);
  const [dishesLoading, setDishesLoading] = useState(false);
  const fetchedRef = useRef(false);

  // Lazy-fetch signature dishes the first time the card is expanded.
  useEffect(() => {
    if (!expanded || fetchedRef.current) return;
    fetchedRef.current = true;
    setDishesLoading(true);
    fetchSignatureDishes(r.id)
      .then((d) => setDishes(d))
      .catch(() => setDishes([]))
      .finally(() => setDishesLoading(false));
  }, [expanded, r.id]);

  const hasPhone = !!r.phone;
  const showAnswers = (s.phase === "done" || (s.phase === "calling" && s.result)) && s.result;

  return (
    <div
      data-restaurant-id={r.id}
      className={`rounded-2xl border transition-colors ${
        selected
          ? "bg-violet-900/15 border-violet-500/25"
          : "bg-white/[0.02] border-white/[0.04]"
      } ${!hasPhone ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3 p-3">
        <Checkbox
          checked={selected}
          disabled={!hasPhone || batchRunning}
          onClick={() => hasPhone && onToggleSelection(r.id)}
        />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left cursor-pointer hover:bg-white/[0.02] -m-1 p-1 rounded-md transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{categoryEmoji[r.category]}</span>
            <span className="text-[13px] font-semibold text-white truncate">{r.name}</span>
            <Chevron expanded={expanded} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
            <span className="text-amber-400">★</span>
            <span>{r.rating.toFixed(1)}</span>
            <span className="text-gray-700">·</span>
            <span>{r.reviewCount} reviews</span>
            {priceLevelLabel(r.priceLevel) && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-emerald-400/80 font-semibold">
                  {priceLevelLabel(r.priceLevel)}
                </span>
              </>
            )}
            {!hasPhone && <span className="text-gray-600 ml-auto">No phone</span>}
          </div>

          {s.phase === "calling" && <CallingIndicator label={s.progress || "Calling..."} />}
          {s.phase === "error" && (
            <p className="mt-2 text-[11px] text-rose-400">{s.error}</p>
          )}

          {showAnswers && s.result && (
            <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/[0.05] p-2.5 space-y-1.5 text-[11px]">
              {Object.entries(s.result.answers).map(([key, ans]) => (
                <AnswerRow key={key} questionKey={key} answer={ans} />
              ))}
              {s.phase === "done" && Object.keys(s.result.answers).length === 0 && (
                <p className="text-gray-500 italic">No structured answers parsed.</p>
              )}
            </div>
          )}
        </button>
      </div>

      {expanded && (
        <DetailsPanel restaurant={r} dishes={dishes} dishesLoading={dishesLoading} />
      )}
    </div>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3 h-3 ml-auto text-gray-500 transition-transform ${
        expanded ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function priceLevelLabel(level: Restaurant["priceLevel"]): string {
  if (!level) return "";
  // Google returns "PRICE_LEVEL_INEXPENSIVE" etc.; trim to bucket name.
  const bucket = level.replace("PRICE_LEVEL_", "");
  return (
    {
      INEXPENSIVE: "$",
      MODERATE: "$$",
      EXPENSIVE: "$$$",
      VERY_EXPENSIVE: "$$$$",
      FREE: "Free",
    }[bucket] ?? ""
  );
}

function DetailsPanel({
  restaurant: r,
  dishes,
  dishesLoading,
}: {
  restaurant: Restaurant;
  dishes: string[] | null;
  dishesLoading: boolean;
}) {
  const features: { icon: string; label: string }[] = [];
  if (r.isWheelchairAccessible) features.push({ icon: "♿", label: "Wheelchair" });
  if (r.parkingType) features.push({ icon: "🅿️", label: `${r.parkingType} parking` });
  if (r.hasLiveMusic) features.push({ icon: "🎵", label: "Live music" });
  if (r.allowsDogs) features.push({ icon: "🐕", label: "Dogs OK" });
  if (r.servesCocktails) features.push({ icon: "🍸", label: "Cocktails" });

  return (
    <div className="px-3 pb-3 pt-2 border-t border-white/[0.04] space-y-2.5 text-[11px]">
      {/* Status row */}
      <div className="flex items-center gap-2 flex-wrap">
        {r.isOpenNow != null && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
              r.isOpenNow
                ? "bg-emerald-900/40 text-emerald-300 border border-emerald-500/20"
                : "bg-rose-900/40 text-rose-300 border border-rose-500/20"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                r.isOpenNow ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            {r.isOpenNow ? "Open now" : "Closed"}
          </span>
        )}
        {r.phone && <span className="text-gray-500 font-mono">{r.phone}</span>}
      </div>

      {/* Feature badges */}
      {features.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {features.map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-gray-300"
            >
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Signature dishes (LLM-extracted from reviews on first expand) */}
      <SignatureDishes dishes={dishes} loading={dishesLoading} />

      {/* Description */}
      {r.description && (
        <p className="text-gray-400 leading-relaxed">{r.description}</p>
      )}

      {/* Top review */}
      {r.topReview && (
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-2.5">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 font-bold mb-1">
            Top review
          </p>
          <p className="text-gray-400 italic leading-relaxed line-clamp-4">
            “{r.topReview}”
          </p>
        </div>
      )}

      {/* Empty-state — when the place has no enriched data */}
      {!r.description &&
        !r.topReview &&
        features.length === 0 &&
        r.isOpenNow == null &&
        (dishes?.length ?? 0) === 0 &&
        !dishesLoading && (
          <p className="text-gray-600 italic">No additional details available.</p>
        )}
    </div>
  );
}

function SignatureDishes({
  dishes,
  loading,
}: {
  dishes: string[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <span>Reading reviews for signature dishes…</span>
      </div>
    );
  }
  if (!dishes || dishes.length === 0) return null;
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-gray-600 font-bold mb-1">
        🍽 Signature dishes
      </p>
      <div className="flex flex-wrap gap-1.5">
        {dishes.map((d) => (
          <span
            key={d}
            className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-200 font-medium"
          >
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

function Checkbox({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
        checked
          ? "bg-violet-500 border-violet-500 text-white"
          : "border-white/20 hover:border-violet-400/60"
      } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      {checked && (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

function CallingIndicator({ label }: { label: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] text-violet-300">
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      {label}
    </div>
  );
}

function AnswerRow({ questionKey, answer: ans }: { questionKey: string; answer: QuestionAnswer }) {
  const label = QUESTION_LABEL_MAP[questionKey] ?? questionKey;
  const icon = ans.value === true ? "✓" : ans.value === false ? "✗" : "?";
  const iconCls =
    ans.value === true
      ? "text-emerald-400"
      : ans.value === false
      ? "text-rose-400"
      : "text-gray-500";

  return (
    <div className="flex items-start gap-2">
      <span className={`${iconCls} font-bold w-3 text-center mt-0.5 flex-shrink-0`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-200 font-medium">{label}</span>
          {questionKey === "reservation" &&
            ans.wait_minutes != null &&
            ans.wait_minutes > 0 && (
              <span className="text-amber-300 text-[10px] font-semibold">
                ~{ans.wait_minutes} min wait
              </span>
            )}
        </div>
        {ans.details && (
          <p className="text-gray-500 leading-relaxed">{ans.details}</p>
        )}
      </div>
    </div>
  );
}
