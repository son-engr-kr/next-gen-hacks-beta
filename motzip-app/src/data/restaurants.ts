import { Restaurant, Category } from "@/types/restaurant";

// Deterministic pseudo-random from seed
function seededRandom(seed: number): () => number {
  let s = Math.abs(seed) || 1; // never 0
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0x7fffffff) / 2147483647; // always [0, 1)
  };
}

const BOSTON_NEIGHBORHOODS: { name: string; lat: number; lng: number; radius: number }[] = [
  { name: "North End", lat: 42.3636, lng: -71.0544, radius: 0.003 },
  { name: "Back Bay", lat: 42.3503, lng: -71.0810, radius: 0.005 },
  { name: "South End", lat: 42.3418, lng: -71.0700, radius: 0.004 },
  { name: "Seaport", lat: 42.3489, lng: -71.0440, radius: 0.004 },
  { name: "Downtown", lat: 42.3554, lng: -71.0587, radius: 0.004 },
  { name: "Chinatown", lat: 42.3509, lng: -71.0623, radius: 0.002 },
  { name: "Fenway", lat: 42.3440, lng: -71.0980, radius: 0.004 },
  { name: "Harvard Square", lat: 42.3731, lng: -71.1192, radius: 0.003 },
  { name: "Central Square", lat: 42.3651, lng: -71.1035, radius: 0.003 },
  { name: "Kendall Square", lat: 42.3626, lng: -71.0862, radius: 0.003 },
  { name: "East Boston", lat: 42.3753, lng: -71.0385, radius: 0.003 },
  { name: "Allston", lat: 42.3529, lng: -71.1321, radius: 0.004 },
  { name: "Brookline", lat: 42.3418, lng: -71.1296, radius: 0.004 },
  { name: "Jamaica Plain", lat: 42.3097, lng: -71.1156, radius: 0.004 },
  { name: "Somerville", lat: 42.3951, lng: -71.1000, radius: 0.005 },
  { name: "Beacon Hill", lat: 42.3588, lng: -71.0707, radius: 0.002 },
  { name: "Waterfront", lat: 42.3594, lng: -71.0502, radius: 0.003 },
  { name: "Davis Square", lat: 42.3969, lng: -71.1225, radius: 0.002 },
  { name: "Inman Square", lat: 42.3739, lng: -71.0992, radius: 0.002 },
  { name: "South Boston", lat: 42.3380, lng: -71.0480, radius: 0.004 },
];

const RESTAURANT_TEMPLATES: { names: string[]; category: Category }[] = [
  { names: ["Burger Lab", "Shake Joint", "The Patty Melt", "Stack'd Burgers", "Smash House", "Flame Grill", "The Burger Spot", "Charred & Co"], category: "burger" },
  { names: ["Napoli Slice", "Brick Oven Co", "Pie Society", "Crust & Crumb", "Flatbread Kitchen", "Dough Boys", "Pizza Union", "The Slice Bar"], category: "pizza" },
  { names: ["Sakura Sushi", "Omakase House", "Blue Fin", "Maki Roll Bar", "Zen Sushi", "Nori Kitchen", "Koi Sushi", "The Fish Counter"], category: "sushi" },
  { names: ["Noodle House", "Tonkotsu Lab", "Ramen District", "Broth & Bowl", "Slurp Station", "Miso Kitchen", "Umami Ramen", "Steamy Bowl"], category: "ramen" },
  { names: ["Morning Brew", "Bean & Leaf", "The Roastery", "Drip Culture", "Press Coffee", "Café Noir", "Latte Lane", "The Grind"], category: "cafe" },
  { names: ["Taco Libre", "El Fuego", "Maize Cantina", "La Cocina", "Salsa Verde", "Agave Kitchen", "Burrito Republic", "Pico's Place"], category: "mexican" },
  { names: ["Trattoria Roma", "Pasta Fresca", "Olive & Vine", "Nonna's Table", "Il Forno", "Basilico", "Tuscan Kitchen", "Amalfi Coast"], category: "italian" },
  { names: ["Golden Dragon", "Wok & Roll", "Jade Palace", "Dim Sum Garden", "Lucky Noodle", "Panda Express+", "Silk Road Kitchen", "Dynasty Kitchen"], category: "chinese" },
  { names: ["Thai Orchid", "Basil & Spice", "Siam Kitchen", "Pad Thai House", "Lemongrass", "Bangkok Bites", "Coconut Curry Co", "Chili Lime Thai"], category: "thai" },
  { names: ["Prime Cut", "The Chophouse", "Rare & Done", "Sizzle Steaks", "Cattleman's", "Fire & Iron", "The Grill Room", "Oak & Ember"], category: "steakhouse" },
  { names: ["The Oyster Bar", "Catch of the Day", "Harbor Fish", "Neptune's Table", "Lobster Landing", "Sea Salt Kitchen", "The Clam Shack", "Tide Pool"], category: "seafood" },
  { names: ["Rise Bakery", "Crumb & Cream", "The Flour Shop", "Sweet Layers", "Golden Crust", "Sugar & Dough", "Proof Bakery", "Whisk & Roll"], category: "bakery" },
];

// Well-known Boston restaurants (hand-picked)
const FAMOUS_RESTAURANTS: Restaurant[] = [
  { id: "f1", name: "Neptune Oyster", category: "seafood", lat: 42.3636, lng: -71.0552, rating: 4.8, reviewCount: 490, isTrending: true, description: "Tiny North End spot with the city's best lobster roll.", topReview: "Hot butter lobster roll is life-changing. Get there early." },
  { id: "f2", name: "Giacomo's", category: "italian", lat: 42.3641, lng: -71.0537, rating: 4.5, reviewCount: 420, isTrending: false, description: "Cash-only, no-reservations Italian with massive portions.", topReview: "Lobster fra diavolo is enormous and delicious." },
  { id: "f3", name: "Mike's Pastry", category: "bakery", lat: 42.3639, lng: -71.0541, rating: 4.2, reviewCount: 470, isTrending: false, description: "Iconic Boston cannoli shop. Tourist magnet for a reason.", topReview: "Florentine cannoli is huge and crunchy." },
  { id: "f4", name: "Saltie Girl", category: "seafood", lat: 42.3503, lng: -71.0809, rating: 4.7, reviewCount: 340, isTrending: true, description: "Boutique seafood bar with tinned fish and raw bar.", topReview: "Lobster with brown butter blew my mind." },
  { id: "f5", name: "Los Tacos No. 1", category: "mexican", lat: 42.3396, lng: -71.0687, rating: 4.5, reviewCount: 360, isTrending: false, description: "Tapas-style with a South End twist.", topReview: "Corn with aioli is a must." },
  { id: "f6", name: "O Ya", category: "sushi", lat: 42.3499, lng: -71.0587, rating: 4.9, reviewCount: 280, isTrending: true, description: "Michelin-worthy omakase. One of the best sushi in the US.", topReview: "Every piece is a masterpiece." },
  { id: "f7", name: "Regina Pizzeria", category: "pizza", lat: 42.3651, lng: -71.0563, rating: 4.6, reviewCount: 500, isTrending: true, description: "The original North End location since 1926.", topReview: "Giambotta pizza is a Boston pilgrimage." },
  { id: "f8", name: "Mr. Bartley's", category: "burger", lat: 42.3731, lng: -71.1192, rating: 4.4, reviewCount: 390, isTrending: false, description: "Harvard Square burger legend since 1960.", topReview: "Celebrity-named burgers. Cash only, totally worth it." },
  { id: "f9", name: "Flour Bakery", category: "bakery", lat: 42.3392, lng: -71.0653, rating: 4.6, reviewCount: 400, isTrending: false, description: "Joanne Chang's beloved bakery. Sticky buns are legendary.", topReview: "Sticky bun is the best pastry in Boston." },
  { id: "f10", name: "Gourmet Dumpling House", category: "chinese", lat: 42.3509, lng: -71.0623, rating: 4.3, reviewCount: 370, isTrending: false, description: "Beloved dumpling spot in Chinatown.", topReview: "Soup dumplings are juicy and perfect." },
  { id: "f11", name: "Island Creek Oyster Bar", category: "seafood", lat: 42.3481, lng: -71.0952, rating: 4.6, reviewCount: 380, isTrending: true, description: "Farm-to-table oyster bar from Duxbury.", topReview: "Oysters are pristine. Lobster roe noodles unforgettable." },
  { id: "f12", name: "Santarpio's Pizza", category: "pizza", lat: 42.3753, lng: -71.0385, rating: 4.5, reviewCount: 410, isTrending: false, description: "No-frills East Boston pizza legend since 1903.", topReview: "Thin crust, charred edges, perfect sauce." },
  { id: "f13", name: "Tatte Bakery", category: "bakery", lat: 42.3733, lng: -71.1195, rating: 4.5, reviewCount: 350, isTrending: false, description: "Israeli-inspired bakery & cafe. Beautiful pastries.", topReview: "Halva croissant is unreal." },
  { id: "f14", name: "Rino's Place", category: "italian", lat: 42.3767, lng: -71.0374, rating: 4.7, reviewCount: 350, isTrending: true, description: "Hidden gem Italian in Eastie.", topReview: "Lobster ravioli in pink sauce is the best pasta I've ever had." },
  { id: "f15", name: "Legal Sea Foods", category: "seafood", lat: 42.3594, lng: -71.0502, rating: 4.1, reviewCount: 450, isTrending: false, description: "Boston's quintessential seafood chain.", topReview: "New England clam chowder is the gold standard." },
];

function generateRestaurants(): Restaurant[] {
  const generated: Restaurant[] = [];
  let id = 100;

  for (const hood of BOSTON_NEIGHBORHOODS) {
    const rand = seededRandom(Math.round(hood.lat * 10000 + hood.lng * 10000));

    // 6-10 restaurants per neighborhood
    const count = 6 + Math.floor(rand() * 5);

    for (let i = 0; i < count; i++) {
      const template = RESTAURANT_TEMPLATES[Math.floor(rand() * RESTAURANT_TEMPLATES.length) % RESTAURANT_TEMPLATES.length];
      const nameBase = template.names[Math.floor(rand() * template.names.length) % template.names.length];
      const name = i % 3 === 0 ? `${nameBase} ${hood.name.split(" ")[0]}` : nameBase;

      const lat = hood.lat + (rand() - 0.5) * hood.radius * 2;
      const lng = hood.lng + (rand() - 0.5) * hood.radius * 2;
      const rating = Math.round((3.2 + rand() * 1.7) * 10) / 10;
      const reviewCount = 20 + Math.floor(rand() * 480);
      const isTrending = rating >= 4.6 && reviewCount >= 350;

      generated.push({
        id: String(id++),
        name,
        category: template.category,
        lat,
        lng,
        rating,
        reviewCount,
        isTrending,
        description: `${template.category.charAt(0).toUpperCase() + template.category.slice(1)} spot in ${hood.name}.`,
        topReview: "",
      });
    }
  }

  return generated;
}

export const restaurants: Restaurant[] = [...FAMOUS_RESTAURANTS, ...generateRestaurants()];
