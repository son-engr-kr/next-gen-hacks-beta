"use client";

import { Restaurant, categoryEmoji } from "@/types/restaurant";

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

export default function RestaurantPanel({ restaurant, onClose }: Props) {
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
        </div>

        {/* Bottom accent */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
      </div>
    </div>
  );
}
