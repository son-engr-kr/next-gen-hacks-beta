export interface Restaurant {
  id: string;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  isTrending: boolean;
  description: string;
  topReview: string;
  // Google Places enrichment — absent in static demo data
  isWheelchairAccessible?: boolean;
  parkingType?: "free" | "paid" | "valet" | null;
  isOpenNow?: boolean | null;
  hasLiveMusic?: boolean;
  allowsDogs?: boolean;
  servesCocktails?: boolean;
  priceLevel?: "FREE" | "INEXPENSIVE" | "MODERATE" | "EXPENSIVE" | "VERY_EXPENSIVE" | null;
  phone?: string | null;
}

export type Category =
  | "burger"
  | "pizza"
  | "sushi"
  | "ramen"
  | "cafe"
  | "mexican"
  | "italian"
  | "chinese"
  | "thai"
  | "steakhouse"
  | "seafood"
  | "bakery";

export const categoryEmoji: Record<Category, string> = {
  burger: "🍔",
  pizza: "🍕",
  sushi: "🍣",
  ramen: "🍜",
  cafe: "☕",
  mexican: "🌮",
  italian: "🍝",
  chinese: "🥡",
  thai: "🍛",
  steakhouse: "🥩",
  seafood: "🦞",
  bakery: "🧁",
};
