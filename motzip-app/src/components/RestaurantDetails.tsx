"use client";

import { useEffect, useState } from "react";
import { Restaurant } from "@/types/restaurant";
import { fetchSignatureDishes } from "@/lib/callApi";

interface Props {
  restaurant: Restaurant;
  /** Render with a top divider — set when the parent has content above. */
  withTopDivider?: boolean;
  /** Render the panel without the outer padding wrapper (e.g. when slotted
   *  inside a card that already has padding). */
  flush?: boolean;
}

/** Reusable details panel shown by both the single-restaurant RestaurantPanel
 *  (map click) and the batch-call RestaurantCallCard (voice search results).
 *  Shows open/closed status, price, phone, feature badges, signature dishes
 *  (LLM-extracted lazily), description, and top review. */
export default function RestaurantDetails({ restaurant: r, withTopDivider, flush }: Props) {
  const [dishes, setDishes] = useState<string[] | null>(null);
  const [dishesLoading, setDishesLoading] = useState(false);

  // Re-fetch whenever the restaurant id changes — the parent can reuse this
  // component across different restaurants (e.g. RestaurantPanel as the user
  // clicks different buildings in turn). `cancelled` guards against a stale
  // response from the previous id arriving after a newer one started.
  useEffect(() => {
    let cancelled = false;
    setDishes(null);
    setDishesLoading(true);
    fetchSignatureDishes(r.id)
      .then((d) => { if (!cancelled) setDishes(d); })
      .catch(() => { if (!cancelled) setDishes([]); })
      .finally(() => { if (!cancelled) setDishesLoading(false); });
    return () => { cancelled = true; };
  }, [r.id]);

  const features: { icon: string; label: string }[] = [];
  if (r.isWheelchairAccessible) features.push({ icon: "♿", label: "Wheelchair" });
  if (r.parkingType) features.push({ icon: "🅿️", label: `${r.parkingType} parking` });
  if (r.hasLiveMusic) features.push({ icon: "🎵", label: "Live music" });
  if (r.allowsDogs) features.push({ icon: "🐕", label: "Dogs OK" });
  if (r.servesCocktails) features.push({ icon: "🍸", label: "Cocktails" });

  const priceLabel = priceLevelLabel(r.priceLevel);
  const isEmpty =
    !r.description &&
    !r.topReview &&
    features.length === 0 &&
    r.isOpenNow == null &&
    !priceLabel &&
    (dishes?.length ?? 0) === 0 &&
    !dishesLoading;

  const wrapperCls = flush
    ? "space-y-2.5 text-[11px]"
    : `${withTopDivider ? "border-t border-white/[0.04] pt-2" : ""} space-y-2.5 text-[11px]`;

  return (
    <div className={wrapperCls}>
      {/* Status row */}
      {(r.isOpenNow != null || r.phone || priceLabel) && (
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
          {priceLabel && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-emerald-300 font-semibold">
              {priceLabel}
            </span>
          )}
          {r.phone && <span className="text-gray-500 font-mono">{r.phone}</span>}
        </div>
      )}

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

      {/* Signature dishes (LLM-extracted, lazy) */}
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

      {isEmpty && (
        <p className="text-gray-600 italic">No additional details available.</p>
      )}
    </div>
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
