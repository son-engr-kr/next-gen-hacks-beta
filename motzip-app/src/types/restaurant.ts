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
