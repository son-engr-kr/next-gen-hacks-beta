import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import maplibregl from "maplibre-gl";
import { Restaurant, Category } from "@/types/restaurant";

// --- Procedural window texture ---
function createWindowTexture(
  rating: number,
  isTrending: boolean,
  width = 64,
  height = 128
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const wallColors = ["#1a1a2e", "#16213e", "#0f1626", "#1b1b2f", "#162447"];
  ctx.fillStyle = wallColors[Math.floor(rating * 10) % wallColors.length];
  ctx.fillRect(0, 0, width, height);

  const cols = 4, rows = 8, winW = 8, winH = 10;
  const padX = (width  - cols * winW) / (cols + 1);
  const padY = (height - rows * winH) / (rows + 1);

  const warmColors = ["#ffeaa7", "#fdcb6e", "#f8e71c", "#fff3cd", "#ffe0b2"];
  const coolColors = ["#74b9ff", "#a29bfe", "#81ecec"];

  let rng = Math.round(rating * 1000) || 1;
  const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = padX + col * (winW + padX);
      const y = padY + row * (winH + padY);
      if (rand() < (isTrending ? 0.85 : 0.4 + rating * 0.08)) {
        const palette = rand() > 0.3 ? warmColors : coolColors;
        ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
        ctx.globalAlpha = 0.6 + rand() * 0.4;
        ctx.fillRect(x, y, winW, winH);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x, y, winW, winH);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function ratingToEmissiveColor(rating: number): THREE.Color {
  if (rating >= 4.5) return new THREE.Color(0.95, 0.7, 0.05);
  if (rating >= 4.0) return new THREE.Color(0.7, 0.45, 0.05);
  if (rating >= 3.5) return new THREE.Color(0.45, 0.18, 0.02);
  return new THREE.Color(0.25, 0.06, 0.02);
}

function ratingToColor(rating: number): THREE.Color {
  if (rating >= 4.5) return new THREE.Color("#FFD700");
  if (rating >= 4.2) return new THREE.Color("#FFC125");
  if (rating >= 4.0) return new THREE.Color("#FF8C00");
  if (rating >= 3.8) return new THREE.Color("#FF6B3A");
  if (rating >= 3.5) return new THREE.Color("#E8554E");
  return new THREE.Color("#C0392B");
}

const REF_LNG = -71.058;
const REF_LAT  = 42.355;

function getBuildingTier(reviewCount: number, rating: number): "landmark" | "major" | "mid" | "regular" {
  const score = reviewCount * rating;
  if (score >= 2000 && rating >= 4.5) return "landmark";
  if (score >= 1500 && rating >= 4.2) return "major";
  if (score >= 700)                   return "mid";
  return "regular";
}

function getBuildingBaseW(r: Restaurant, s: number): number {
  const tier = getBuildingTier(r.reviewCount, r.rating);
  if (tier === "landmark") return 35 * s;
  if (tier === "major")    return 26 * s;
  if (tier === "mid")      return 18 * s;
  return (12 + Math.min(r.reviewCount * 0.01, 8)) * s;
}

function makeWallMat(texture: THREE.CanvasTexture, rating: number, metalBoost = 0) {
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: ratingToColor(rating),
    emissive: ratingToEmissiveColor(rating),
    emissiveIntensity: 0.6 + metalBoost * 0.3,
    metalness: Math.min(1, (rating >= 4.5 ? 0.6 : 0.2) + metalBoost),
    roughness: Math.max(0.1, (rating >= 4.5 ? 0.3 : 0.7) - metalBoost),
    side: THREE.BackSide,
  });
}

function makeTopMat(rating: number, premium = false) {
  return new THREE.MeshStandardMaterial({
    color:   premium ? new THREE.Color("#FFD700") : new THREE.Color("#ffffff"),
    emissive: premium ? new THREE.Color(1.0, 0.78, 0.05) : ratingToEmissiveColor(rating),
    emissiveIntensity: premium ? 0.7 : 0.35,
    metalness: premium ? 0.9 : 0.8,
    roughness: premium ? 0.1 : 0.2,
    side: THREE.BackSide,
  });
}

const bottomMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#111111"), side: THREE.BackSide });

function addBoxSection(group: THREE.Group, w: number, d: number, h: number, zBase: number, wallMat: THREE.Material, topMat: THREE.Material) {
  const geo = new THREE.BoxGeometry(w, d, h);
  geo.translate(0, 0, zBase + h / 2);
  group.add(new THREE.Mesh(geo, [wallMat, wallMat, wallMat, wallMat, topMat, bottomMat]));
  return zBase + h;
}

function addCylinderSection(group: THREE.Group, rB: number, rT: number, h: number, zBase: number, mat: THREE.Material, topMat: THREE.Material, seg = 8) {
  const geo = new THREE.CylinderGeometry(rT, rB, h, seg);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, zBase + h / 2);
  group.add(new THREE.Mesh(geo, [mat, topMat, bottomMat]));
  return zBase + h;
}

// ── GLB types ──────────────────────────────────────────────────────────────────
type TierModelKey    = "building_regular" | "building_mid" | "building_major";
type LandmarkModelKey = `landmark_${Category}`;
type ModelKey        = TierModelKey | LandmarkModelKey;
type BuildingModels  = Partial<Record<ModelKey, THREE.Group>>;
type FoodModels      = Partial<Record<Category, THREE.Group>>;

function placeGlbModel(template: THREE.Group, targetW: number, targetH: number): THREE.Group {
  const clone = template.clone(true);
  clone.rotation.x = Math.PI / 2;
  const size = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
  const sc = Math.min(targetW / Math.max(size.x, size.y), targetH / size.z);
  clone.scale.setScalar(sc);
  clone.position.z = -new THREE.Box3().setFromObject(clone).min.z;
  clone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      const ds = (mat: THREE.Material) => {
        mat.side = THREE.DoubleSide;
        const std = mat as THREE.MeshStandardMaterial;
        if (std.envMapIntensity !== undefined) std.envMapIntensity = 2.0;
      };
      Array.isArray(m.material) ? m.material.forEach(ds) : m.material && ds(m.material);
    }
  });
  return clone;
}

// ── Procedural buildings ───────────────────────────────────────────────────────
function buildProceduralLandmark(r: Restaurant, s: number): THREE.Group {
  const group = new THREE.Group();
  const totalH = r.reviewCount * 1.2 * s, baseW = 35 * s;
  const tex  = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating + 0.3, r.isTrending, 48, 96);
  let z = 0;
  z = addBoxSection(group, baseW, baseW, totalH * 0.15, z, makeWallMat(tex, r.rating), makeTopMat(r.rating));
  z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.30, z, makeWallMat(tex, r.rating, 0.2), makeTopMat(r.rating, true));
  const geo2 = new THREE.BoxGeometry(baseW * 0.5, baseW * 0.5, totalH * 0.25);
  geo2.translate(0, 0, z + totalH * 0.25 / 2);
  const m2 = new THREE.Mesh(geo2, [makeWallMat(tex2, r.rating, 0.4), makeWallMat(tex2, r.rating, 0.4), makeWallMat(tex2, r.rating, 0.4), makeWallMat(tex2, r.rating, 0.4), makeTopMat(r.rating, true), bottomMat]);
  m2.rotation.z = Math.PI / 4;
  group.add(m2); z += totalH * 0.25;
  const spireMat = new THREE.MeshStandardMaterial({ color: "#FFD700", emissive: new THREE.Color(1, 0.8, 0.2), emissiveIntensity: 0.6, metalness: 0.95, roughness: 0.05, side: THREE.BackSide });
  addCylinderSection(group, baseW * 0.15, baseW * 0.02, totalH * 0.30, z, spireMat, spireMat, 6);
  return group;
}

function buildProceduralMajor(r: Restaurant, s: number): THREE.Group {
  const group = new THREE.Group();
  const totalH = r.reviewCount * 0.9 * s, baseW = 26 * s;
  const tex = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating, r.isTrending, 48, 96);
  let z = 0;
  z = addBoxSection(group, baseW, baseW, totalH * 0.4, z, makeWallMat(tex, r.rating), makeTopMat(r.rating));
  z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.35, z, makeWallMat(tex2, r.rating, 0.15), makeTopMat(r.rating));
  z = addBoxSection(group, baseW * 0.45, baseW * 0.45, totalH * 0.25, z, makeWallMat(tex, r.rating, 0.3), makeTopMat(r.rating, true));
  const antMat = new THREE.MeshStandardMaterial({ color: "#cccccc", metalness: 0.9, roughness: 0.1, side: THREE.BackSide });
  addCylinderSection(group, baseW * 0.03, baseW * 0.01, totalH * 0.12, z, antMat, antMat, 4);
  return group;
}

function buildProceduralMid(r: Restaurant, s: number): THREE.Group {
  const group = new THREE.Group();
  const totalH = r.reviewCount * 0.7 * s, baseW = 18 * s;
  const tex = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating, r.isTrending, 48, 96);
  let z = 0;
  z = addBoxSection(group, baseW, baseW, totalH * 0.55, z, makeWallMat(tex, r.rating), makeTopMat(r.rating));
  addBoxSection(group, baseW * 0.65, baseW * 0.65, totalH * 0.45, z, makeWallMat(tex2, r.rating, 0.1), makeTopMat(r.rating));
  return group;
}

function buildProceduralRegular(r: Restaurant, s: number): THREE.Group {
  const group = new THREE.Group();
  const h = Math.max(30, r.reviewCount * 0.6) * s;
  const w = (12 + Math.min(r.reviewCount * 0.01, 8)) * s;
  addBoxSection(group, w, w, h, 0, makeWallMat(createWindowTexture(r.rating, r.isTrending), r.rating), makeTopMat(r.rating));
  return group;
}

function createBuildingGroup(r: Restaurant, refMerc: maplibregl.MercatorCoordinate, s: number, models: BuildingModels | null): THREE.Group {
  const tier = getBuildingTier(r.reviewCount, r.rating);
  const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
  const outer = new THREE.Group();
  outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, 0);

  // Only landmarks with a category-themed GLB get a building mesh.
  // Anything else (non-landmark, or landmark with missing themed GLB) renders as a floating food icon only.
  if (tier === "landmark") {
    const tpl = models?.[`landmark_${r.category}` as LandmarkModelKey];
    if (tpl) outer.add(placeGlbModel(tpl, 50 * s, r.reviewCount * 1.7 * s));
  }
  return outer;
}

// ── Model loading ──────────────────────────────────────────────────────────────
const MODEL_KEYS: ModelKey[] = [
  "building_regular", "building_mid", "building_major",
  "landmark_burger", "landmark_pizza", "landmark_sushi", "landmark_ramen",
  "landmark_cafe", "landmark_mexican", "landmark_italian", "landmark_chinese",
  "landmark_thai", "landmark_steakhouse", "landmark_seafood", "landmark_bakery",
];

async function loadBuildingModels(loader: GLTFLoader): Promise<BuildingModels> {
  const models: BuildingModels = {};
  await Promise.allSettled(MODEL_KEYS.map((key) => new Promise<void>((resolve) => {
    loader.load(`/models/buildings/${key}.glb`, (gltf) => { models[key] = gltf.scene as THREE.Group; resolve(); }, undefined, () => resolve());
  })));
  return models;
}

const FOOD_CATEGORIES: Category[] = ["burger","pizza","sushi","ramen","cafe","mexican","italian","chinese","thai","steakhouse","seafood","bakery"];

async function loadFoodModels(loader: GLTFLoader): Promise<FoodModels> {
  const models: FoodModels = {};
  await Promise.allSettled(FOOD_CATEGORIES.map((cat) => new Promise<void>((resolve) => {
    loader.load(`/models/food/${cat}.glb`, (gltf) => { models[cat] = gltf.scene as THREE.Group; resolve(); }, undefined, () => resolve());
  })));
  return models;
}

// ── Feature marker system ──────────────────────────────────────────────────────
//
// Each restaurant feature is shown as a small icon sprite floating just above
// the ground beside the building. Multiple features = a compact row of sprites.
// A trending building also gets a vertical light-beam column.

type FeatureIconKey =
  | "trending" | "wheelchair"
  | "parking_free" | "parking_paid" | "parking_valet"
  | "live_music" | "dogs" | "cocktails";

const FEATURE_ICON_PATHS: Record<FeatureIconKey, string> = {
  trending:       "/icons/trending.svg",
  wheelchair:     "/icons/wheelchair.svg",
  parking_free:   "/icons/parking_free.svg",
  parking_paid:   "/icons/parking_paid.svg",
  parking_valet:  "/icons/parking_valet.svg",
  live_music:     "/icons/live_music.svg",
  dogs:           "/icons/dogs.svg",
  cocktails:      "/icons/cocktails.svg",
};

const featureIconTextures: Partial<Record<FeatureIconKey, THREE.Texture>> = {};

function getFeatureIconTexture(key: FeatureIconKey): THREE.Texture {
  let tex = featureIconTextures[key];
  if (!tex) {
    tex = new THREE.TextureLoader().load(FEATURE_ICON_PATHS[key]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    featureIconTextures[key] = tex;
  }
  return tex;
}

interface FeatureMarker {
  mesh: THREE.Mesh;
  baseZ: number;
  bobOffset: number;
  restaurantIdx: number;
}

/** Vertical plane mesh showing a feature icon next to a building. */
function createFeatureIcon(key: FeatureIconKey, s: number): THREE.Mesh {
  const size = 8 * s;
  const geo = new THREE.PlaneGeometry(size, size);
  // Stand the plane upright (normal along +Y) so it's visible from map-tilt views.
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getFeatureIconTexture(key),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Vertical light-beam column for trending buildings.
 * Single translucent outer glow cone.
 */
function createTrendingBeacon(topZ: number, s: number): THREE.Group {
  const group = new THREE.Group();
  const h = topZ + 40 * s;

  // Outer wide cone
  const outerGeo = new THREE.CylinderGeometry(0.8 * s, 22 * s, h, 8, 1, true);
  outerGeo.rotateX(Math.PI / 2);
  outerGeo.translate(0, 0, h / 2);
  group.add(new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({
    color: "#ff6600", emissive: "#ff4400", emissiveIntensity: 0.5,
    transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  })));

  return group;
}

// ── Custom layer export ────────────────────────────────────────────────────────

export interface BuildingLayerHandle {
  layer: maplibregl.CustomLayerInterface;
  setFilter: (ids: Set<string> | null) => void;
}

export function createBuildingCustomLayer(
  map: maplibregl.Map,
  restaurants: Restaurant[]
): BuildingLayerHandle {
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.Camera;

  const refMerc = maplibregl.MercatorCoordinate.fromLngLat([REF_LNG, REF_LAT], 0);
  const s = refMerc.meterInMercatorCoordinateUnits() * 4;

  let buildingGroups: THREE.Group[] = [];
  let foodIconGroups: { outer: THREE.Group; baseZ: number; restaurantIdx: number }[] = [];
  let featureMarkers: FeatureMarker[] = [];
  let trendingBeacons: { group: THREE.Group; restaurantIdx: number }[] = [];

  // ── Voice filter state ─────────────────────────────────────────────────────
  let filteredIds: Set<string> | null = null;
  const targetScales: number[] = [];   // target scale.z per building index
  const currentScales: number[] = [];  // current animated scale.z
  let spotlightBeams: THREE.Mesh[] = [];

  const buildingTopZMap = new Map<string, number>();

  // ── Feature markers ────────────────────────────────────────────────────────

  function rebuildGroundIndicators() {
    featureMarkers.forEach(({ mesh }) => scene.remove(mesh));
    trendingBeacons.forEach(({ group }) => scene.remove(group));
    featureMarkers = [];
    trendingBeacons = [];

    restaurants.forEach((r, ri) => {
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const bx    = merc.x - refMerc.x;
      const by    = merc.y - refMerc.y;
      const baseW = getBuildingBaseW(r, s);

      // Collect active features in priority order
      const features: FeatureIconKey[] = [];
      if (r.isTrending)              features.push("trending");
      if (r.isWheelchairAccessible)  features.push("wheelchair");
      if (r.parkingType === "free")  features.push("parking_free");
      if (r.parkingType === "paid")  features.push("parking_paid");
      if (r.parkingType === "valet") features.push("parking_valet");
      if (r.hasLiveMusic)            features.push("live_music");
      if (r.allowsDogs)              features.push("dogs");
      if (r.servesCocktails)         features.push("cocktails");

      if (features.length > 0) {
        const iconR   = 3 * s;
        const spacing = iconR * 2.4;
        const startX  = bx + baseW * 0.72;
        const startY  = by + baseW * 0.72;
        // Center the row around the diagonal offset
        const rowOffset = ((features.length - 1) * spacing) / 2;

        features.forEach((key, fi) => {
          const mesh = createFeatureIcon(key, s);
          mesh.position.set(
            startX + fi * spacing - rowOffset,
            startY,
            iconR + 1.5 * s,
          );
          scene.add(mesh);
          featureMarkers.push({ mesh, baseZ: iconR + 1.5 * s, bobOffset: ri * 0.9 + fi * 0.5, restaurantIdx: ri });
        });
      }

      // Trending → vertical light-beam column
      if (r.isTrending) {
        const topZ   = buildingTopZMap.get(r.id) ?? 50 * s;
        const beacon = createTrendingBeacon(topZ, s);
        beacon.position.set(bx, by, 0);
        scene.add(beacon);
        trendingBeacons.push({ group: beacon, restaurantIdx: ri });
      }
    });
  }

  // ── Building construction ──────────────────────────────────────────────────

  function rebuildBuildings(models: BuildingModels | null) {
    buildingGroups.forEach((g) => scene.remove(g));
    buildingGroups = [];
    buildingTopZMap.clear();

    for (const r of restaurants) {
      const g = createBuildingGroup(r, refMerc, s, models);

      // Dim closed buildings (Phase 5)
      if (r.isOpenNow === false) {
        g.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const dim  = (mat: THREE.Material) => {
              const m = mat as THREE.MeshStandardMaterial;
              if (m.emissiveIntensity !== undefined) {
                m.emissiveIntensity *= 0.3;
                m.color.multiplyScalar(0.55);
              }
            };
            Array.isArray(mesh.material) ? mesh.material.forEach(dim) : mesh.material && dim(mesh.material);
          }
        });
      }

      scene.add(g);
      buildingGroups.push(g);
      const topZ = new THREE.Box3().setFromObject(g).max.z;
      buildingTopZMap.set(r.id, isFinite(topZ) ? topZ : 32 * s);
    }

    rebuildGroundIndicators();

    // Init scale arrays
    restaurants.forEach((_, i) => {
      targetScales[i]  = filteredIds === null ? 1.0 : (filteredIds.has(restaurants[i].id) ? 1.0 : 0);
      currentScales[i] = buildingGroups[i]?.scale.z ?? 1.0;
    });
  }

  // ── Spotlight beam helpers ─────────────────────────────────────────────────

  function removeSpotlights() {
    spotlightBeams.forEach((m) => scene?.remove(m));
    spotlightBeams = [];
  }

  function addSpotlight(r: Restaurant, topZ: number) {
    const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
    const bx = merc.x - refMerc.x;
    const by = merc.y - refMerc.y;
    const beamH = topZ + 80 * s;

    // Outer wide cone — soft glow
    const outerGeo = new THREE.CylinderGeometry(1.5 * s, 18 * s, beamH, 10, 1, true);
    outerGeo.rotateX(Math.PI / 2);
    outerGeo.translate(0, 0, beamH / 2);
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({
      color: "#ffffff", emissive: "#88ccff", emissiveIntensity: 0.8,
      transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false,
    }));
    outer.position.set(bx, by, 0);
    scene.add(outer);
    spotlightBeams.push(outer);

    // Inner narrow core — bright beam
    const innerGeo = new THREE.CylinderGeometry(0.4 * s, 6 * s, beamH, 6, 1, true);
    innerGeo.rotateX(Math.PI / 2);
    innerGeo.translate(0, 0, beamH / 2);
    const inner = new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({
      color: "#aaddff", emissive: "#66aaff", emissiveIntensity: 1.5,
      transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }));
    inner.position.set(bx, by, 0);
    scene.add(inner);
    spotlightBeams.push(inner);
  }

  // ── setFilter API ──────────────────────────────────────────────────────────

  function setFilter(ids: Set<string> | null) {
    filteredIds = ids;
    removeSpotlights();

    restaurants.forEach((r, i) => {
      if (ids === null) {
        targetScales[i] = 1.0;
      } else if (ids.has(r.id)) {
        targetScales[i] = 1.0;
        const topZ = buildingTopZMap.get(r.id) ?? 50 * s;
        addSpotlight(r, topZ);
      } else {
        targetScales[i] = 0;
      }
    });
  }

  function rebuildFoodIcons(food: FoodModels, buildings: BuildingModels | null) {
    foodIconGroups.forEach(({ outer }) => scene.remove(outer));
    foodIconGroups = [];
    const SIZE = 22 * s, GAP = 8 * s;

    const NON_LANDMARK_FLOAT_Z = 28 * s;

    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const template = food[r.category];
      if (!template) continue;
      const tier = getBuildingTier(r.reviewCount, r.rating);
      // Only skip food when a themed landmark building is actually rendered.
      if (tier === "landmark" && buildings?.[`landmark_${r.category}` as LandmarkModelKey]) continue;

      const buildingTopZ = new THREE.Box3().setFromObject(buildingGroups[i]).max.z;
      const topZ = isFinite(buildingTopZ) ? buildingTopZ : NON_LANDMARK_FLOAT_Z;
      const icon  = placeGlbModel(template, SIZE, SIZE);
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const outer = new THREE.Group();
      outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, topZ + GAP);
      outer.add(icon);
      scene.add(outer);
      foodIconGroups.push({ outer, baseZ: topZ + GAP, restaurantIdx: i });
    }
  }

  // ── Trees (sampled from park / wood polygons) ──────────────────────────────
  const treeGroup = new THREE.Group();
  const placedTreeKeys = new Set<string>();
  const TREE_LAYER_IDS = ["park", "landcover_wood", "landcover_grass"];

  // Shared tree materials — clearly, vividly green
  const TREE_FOLIAGE_COLORS = ["#2d9c40", "#3aa84a", "#4cb55a", "#1f8a3d"];
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#7a5634", roughness: 0.9 });
  const foliageMats = TREE_FOLIAGE_COLORS.map((c) => new THREE.MeshStandardMaterial({
    color: c, emissive: new THREE.Color(c).multiplyScalar(0.4), emissiveIntensity: 0.5, roughness: 0.55,
  }));
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 4, 6);
  trunkGeo.rotateX(Math.PI / 2);
  trunkGeo.translate(0, 0, 2);
  const foliageGeo = new THREE.ConeGeometry(2.6, 6, 6);
  foliageGeo.rotateX(Math.PI / 2);
  foliageGeo.translate(0, 0, 4 + 3);

  function makeTree(scale: number, foliageMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(trunkGeo, trunkMat));
    g.add(new THREE.Mesh(foliageGeo, foliageMat));
    g.scale.setScalar(scale);
    g.rotation.z = Math.random() * Math.PI * 2;
    return g;
  }

  function pointInRing(x: number, y: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function sampleTreesFromVisiblePolygons() {
    if (placedTreeKeys.size > 1500) return; // cap to keep perf sane

    const layersInStyle = TREE_LAYER_IDS.filter((id) => map.getLayer(id));
    if (layersInStyle.length === 0) return;

    let features: maplibregl.MapGeoJSONFeature[];
    try {
      features = map.queryRenderedFeatures({ layers: layersInStyle });
    } catch { return; }

    for (const f of features) {
      const geom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const polygons: number[][][] =
        geom.type === "Polygon" ? [geom.coordinates[0]]
        : geom.type === "MultiPolygon" ? geom.coordinates.map((p) => p[0])
        : [];

      for (const ring of polygons) {
        if (ring.length < 3) continue;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of ring) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const bw = maxX - minX, bh = maxY - minY;
        if (bw < 0.00005 || bh < 0.00005) continue;

        // Density: half again from previous
        const areaScore = bw * bh * 1e7;
        const targetCount = Math.min(7, Math.max(1, Math.round(areaScore * 0.4)));

        let placed = 0, attempts = 0;
        while (placed < targetCount && attempts < targetCount * 6) {
          attempts++;
          const lng = minX + Math.random() * bw;
          const lat = minY + Math.random() * bh;
          if (!pointInRing(lng, lat, ring)) continue;

          // Quantize key to ~6m grid so re-queries don't double-place
          const key = `${Math.round(lng * 50000)}:${Math.round(lat * 50000)}`;
          if (placedTreeKeys.has(key)) continue;
          placedTreeKeys.add(key);

          const merc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
          const tree = makeTree(s * (0.35 + Math.random() * 0.25), foliageMats[Math.floor(Math.random() * foliageMats.length)]);
          tree.position.set(merc.x - refMerc.x, merc.y - refMerc.y, 0);
          treeGroup.add(tree);
          placed++;
        }
      }
    }
  }

  // ── Subway/trains (sampled along railway polylines) ────────────────────────
  const trainGroup = new THREE.Group();
  const placedRailwayKeys = new Set<string>();
  const TRAIN_LAYER_IDS = ["railway", "railway_transit"];
  const TRAIN_CAP = 28;

  interface TrainMover {
    group: THREE.Group;
    segments: { fx: number; fy: number; tx: number; ty: number; len: number }[];
    totalLen: number;
    progress: number; // mercator-units traveled, mod totalLen
    speed: number;    // mercator-units per second
  }
  const trains: TrainMover[] = [];

  // Shared train geo/mats — dark gray subway liveries
  const TRAIN_LIVERIES = [
    { body: "#3d4148", emissive: "#14161a" }, // dark steel
    { body: "#4a4d54", emissive: "#181a1f" }, // charcoal
    { body: "#5c606a", emissive: "#1f2228" }, // slate gray
    { body: "#2d3036", emissive: "#0e1014" }, // graphite
  ];
  const carLen = 4, carW = 2, carH = 2.4, carGap = 0.4;
  const carGeo = new THREE.BoxGeometry(carLen, carW, carH);
  carGeo.translate(0, 0, carH / 2 + 0.3);

  function makeTrain(): THREE.Group {
    const livery = TRAIN_LIVERIES[Math.floor(Math.random() * TRAIN_LIVERIES.length)];
    const bodyMat = new THREE.MeshStandardMaterial({
      color: livery.body, emissive: livery.emissive, emissiveIntensity: 0.35,
      metalness: 0.55, roughness: 0.45, side: THREE.BackSide,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: "#6a6e76", emissive: "#fff0c8", emissiveIntensity: 0.45,
      metalness: 0.5, roughness: 0.4, side: THREE.BackSide,
    });
    const g = new THREE.Group();
    const cars = 3;
    for (let i = 0; i < cars; i++) {
      const mesh = new THREE.Mesh(carGeo, i === 0 ? headMat : bodyMat);
      mesh.position.x = -i * (carLen + carGap);
      g.add(mesh);
    }
    return g;
  }

  function sampleTrainsFromVisibleLines() {
    if (trains.length >= TRAIN_CAP) return;

    const layersInStyle = TRAIN_LAYER_IDS.filter((id) => map.getLayer(id));
    if (layersInStyle.length === 0) return;

    let features: maplibregl.MapGeoJSONFeature[];
    try {
      features = map.queryRenderedFeatures({ layers: layersInStyle });
    } catch { return; }

    for (const f of features) {
      if (trains.length >= TRAIN_CAP) break;
      const geom = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
      const lines: number[][][] =
        geom.type === "LineString" ? [geom.coordinates]
        : geom.type === "MultiLineString" ? geom.coordinates
        : [];

      for (const coords of lines) {
        if (coords.length < 2) continue;

        // Dedup: hash both endpoints (rounded)
        const a = coords[0], b = coords[coords.length - 1];
        const key = `${Math.round(a[0] * 50000)}:${Math.round(a[1] * 50000)}|${Math.round(b[0] * 50000)}:${Math.round(b[1] * 50000)}`;
        if (placedRailwayKeys.has(key)) continue;
        placedRailwayKeys.add(key);

        // Build segments in world (mercator-relative) coords
        const segments: TrainMover["segments"] = [];
        let totalLen = 0;
        for (let i = 0; i < coords.length - 1; i++) {
          const m1 = maplibregl.MercatorCoordinate.fromLngLat([coords[i][0], coords[i][1]], 0);
          const m2 = maplibregl.MercatorCoordinate.fromLngLat([coords[i + 1][0], coords[i + 1][1]], 0);
          const fx = m1.x - refMerc.x, fy = m1.y - refMerc.y;
          const tx = m2.x - refMerc.x, ty = m2.y - refMerc.y;
          const dx = tx - fx, dy = ty - fy;
          const len = Math.hypot(dx, dy);
          if (len > 0) { segments.push({ fx, fy, tx, ty, len }); totalLen += len; }
        }
        if (totalLen < s * 80) continue; // skip short stubs

        const train = makeTrain();
        train.scale.setScalar(s * 1.6);
        trainGroup.add(train);
        trains.push({
          group: train,
          segments,
          totalLen,
          progress: Math.random() * totalLen,
          speed: s * (12 + Math.random() * 18),
        });
      }
    }
  }

  let lastTrainT = Date.now() / 1000;
  function updateTrains() {
    const now = Date.now() / 1000;
    const dt = Math.min(0.1, now - lastTrainT);
    lastTrainT = now;
    for (const t of trains) {
      t.progress = (t.progress + t.speed * dt) % t.totalLen;
      let acc = 0;
      for (const seg of t.segments) {
        if (acc + seg.len > t.progress) {
          const localT = (t.progress - acc) / seg.len;
          t.group.position.x = seg.fx + (seg.tx - seg.fx) * localT;
          t.group.position.y = seg.fy + (seg.ty - seg.fy) * localT;
          t.group.rotation.z = Math.atan2(seg.ty - seg.fy, seg.tx - seg.fx);
          break;
        }
        acc += seg.len;
      }
    }
  }

  // ── Airplanes (sampled from runway lines, takeoff/landing cycle) ───────────
  const planeGroup = new THREE.Group();
  const placedRunwayKeys = new Set<string>();
  const RUNWAY_LAYER_IDS = ["aeroway-runway"];
  const PLANE_CAP = 12;

  interface Plane {
    group: THREE.Group;
    approachStart: { x: number; y: number; z: number };
    touchdown: { x: number; y: number };
    liftoff: { x: number; y: number };
    climbExit: { x: number; y: number; z: number };
    heading: number;
    cycleDur: number;
    phaseOffset: number;
  }
  const planes: Plane[] = [];

  function makePlane(): THREE.Group {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: "#eaecef", emissive: "#888a92", emissiveIntensity: 0.25,
      metalness: 0.6, roughness: 0.35, side: THREE.BackSide,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: "#3b82f6", emissive: "#1e40af", emissiveIntensity: 0.4,
      metalness: 0.5, roughness: 0.4, side: THREE.BackSide,
    });
    const lightR = new THREE.MeshStandardMaterial({
      color: "#ff3030", emissive: "#ff0000", emissiveIntensity: 1.6, side: THREE.BackSide,
    });
    const lightL = new THREE.MeshStandardMaterial({
      color: "#3030ff", emissive: "#0000ff", emissiveIntensity: 1.6, side: THREE.BackSide,
    });
    const g = new THREE.Group();
    // Fuselage along +x (forward)
    const fus = new THREE.Mesh(new THREE.BoxGeometry(10, 1.3, 1.3), bodyMat);
    g.add(fus);
    // Nose accent
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.05, 1.05), accentMat);
    nose.position.x = 5.0;
    g.add(nose);
    // Wings (along y)
    const wings = new THREE.Mesh(new THREE.BoxGeometry(2.8, 9, 0.3), bodyMat);
    g.add(wings);
    // Vertical tail
    const vtail = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 1.8), bodyMat);
    vtail.position.set(-4.0, 0, 1.0);
    g.add(vtail);
    // Horizontal tail
    const htail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 0.25), bodyMat);
    htail.position.set(-4.0, 0, 0.4);
    g.add(htail);
    // Wingtip lights (red right, blue left)
    const lr = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), lightR);
    lr.position.set(0, 4.5, 0.1); g.add(lr);
    const ll = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), lightL);
    ll.position.set(0, -4.5, 0.1); g.add(ll);
    g.rotation.order = "ZYX"; // yaw, then local pitch
    return g;
  }

  function samplePlanesFromRunways() {
    if (planes.length >= PLANE_CAP) return;
    const layersInStyle = RUNWAY_LAYER_IDS.filter((id) => map.getLayer(id));
    if (layersInStyle.length === 0) return;
    let features: maplibregl.MapGeoJSONFeature[];
    try { features = map.queryRenderedFeatures({ layers: layersInStyle }); } catch { return; }

    for (const f of features) {
      if (planes.length >= PLANE_CAP) break;
      const geom = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
      const lines: number[][][] =
        geom.type === "LineString" ? [geom.coordinates]
        : geom.type === "MultiLineString" ? geom.coordinates : [];

      for (const coords of lines) {
        if (coords.length < 2) continue;
        const a = coords[0], b = coords[coords.length - 1];
        const key = `${Math.round(a[0]*50000)}:${Math.round(a[1]*50000)}|${Math.round(b[0]*50000)}:${Math.round(b[1]*50000)}`;
        if (placedRunwayKeys.has(key)) continue;
        placedRunwayKeys.add(key);

        const m1 = maplibregl.MercatorCoordinate.fromLngLat([a[0], a[1]], 0);
        const m2 = maplibregl.MercatorCoordinate.fromLngLat([b[0], b[1]], 0);
        const sx = m1.x - refMerc.x, sy = m1.y - refMerc.y;
        const ex = m2.x - refMerc.x, ey = m2.y - refMerc.y;
        const dx = ex - sx, dy = ey - sy;
        const rwLen = Math.hypot(dx, dy);
        if (rwLen < s * 200) continue; // skip short

        const heading = Math.atan2(dy, dx);
        const ux = Math.cos(heading), uy = Math.sin(heading);
        const cruiseAlt = s * 220;
        const offsetIn = s * 1400;
        const offsetOut = s * 1600;

        const approachStart = { x: sx - ux * offsetIn, y: sy - uy * offsetIn, z: cruiseAlt };
        const touchdown = { x: sx, y: sy };
        const liftoff = { x: ex, y: ey };
        const climbExit = { x: ex + ux * offsetOut, y: ey + uy * offsetOut, z: cruiseAlt };

        // Two planes, staggered phase so action is always visible
        for (let i = 0; i < 2; i++) {
          if (planes.length >= PLANE_CAP) break;
          const plane = makePlane();
          plane.scale.setScalar(s * 2.6);
          planeGroup.add(plane);
          planes.push({
            group: plane,
            approachStart, touchdown, liftoff, climbExit, heading,
            cycleDur: 24 + Math.random() * 8,
            phaseOffset: i * 0.5 + Math.random() * 0.04,
          });
        }
      }
    }
  }

  function updatePlanes(now: number) {
    for (const p of planes) {
      const phase = (((now / p.cycleDur) + p.phaseOffset) % 1 + 1) % 1;
      let x = 0, y = 0, z = 0, pitch = 0;
      let visible = true;

      if (phase < 0.20) {
        // APPROACH — descend toward touchdown
        const u = phase / 0.20;
        x = p.approachStart.x + (p.touchdown.x - p.approachStart.x) * u;
        y = p.approachStart.y + (p.touchdown.y - p.approachStart.y) * u;
        z = p.approachStart.z * (1 - u);
        pitch = -0.10;
      } else if (phase < 0.30) {
        // ROLL on runway
        const u = (phase - 0.20) / 0.10;
        x = p.touchdown.x + (p.liftoff.x - p.touchdown.x) * u;
        y = p.touchdown.y + (p.liftoff.y - p.touchdown.y) * u;
        z = 0;
        pitch = 0;
      } else if (phase < 0.50) {
        // CLIMB — takeoff and ascend
        const u = (phase - 0.30) / 0.20;
        x = p.liftoff.x + (p.climbExit.x - p.liftoff.x) * u;
        y = p.liftoff.y + (p.climbExit.y - p.liftoff.y) * u;
        z = p.climbExit.z * u;
        pitch = 0.20;
      } else {
        // PAUSE — hide between cycles
        visible = false;
      }

      p.group.visible = visible;
      if (visible) {
        p.group.position.set(x, y, z);
        p.group.rotation.set(0, pitch, p.heading);
      }
    }
  }

  // ── Layer interface ────────────────────────────────────────────────────────

  const layer: maplibregl.CustomLayerInterface = {
    id: "3d-buildings",
    type: "custom",
    renderingMode: "3d",

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 4.5));
      const dir = new THREE.DirectionalLight(0xfff0d0, 3.5); dir.position.set(0.5, -0.3, 1.0); scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0xaab0ff, 1.6); dir2.position.set(-0.3, 0.5, 0.8); scene.add(dir2);

      scene.add(treeGroup);
      scene.add(trainGroup);
      scene.add(planeGroup);
      // The render loop calls triggerRepaint every frame, so "idle" never fires.
      // Sample on moveend (after pan/zoom) and once shortly after add (initial parks).
      const sampleAndRepaint = () => {
        sampleTreesFromVisiblePolygons();
        sampleTrainsFromVisibleLines();
        samplePlanesFromRunways();
        map.triggerRepaint();
      };
      map.on("moveend", sampleAndRepaint);
      setTimeout(sampleAndRepaint, 600);
      setTimeout(sampleAndRepaint, 1500);

      for (const r of restaurants.filter((r) => r.isTrending)) {
        const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
        const hMerc = Math.max(30, r.reviewCount * 0.6) * s;
        const light = new THREE.PointLight(0xffaa00, 0.00002, s * 300);
        light.position.set(merc.x - refMerc.x, merc.y - refMerc.y, hMerc + s * 20);
        scene.add(light);
      }

      camera = new THREE.Camera();
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.6;

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
      scene.environmentIntensity = 1.6;
      pmrem.dispose();

      // Soft sky/ground hemisphere fill — natural daytime feel
      scene.add(new THREE.HemisphereLight(0xc8dfff, 0xfff0d0, 1.4));

      const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
      const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
      Promise.all([loadBuildingModels(loader), loadFoodModels(loader)]).then(([buildings, food]) => {
        rebuildBuildings(Object.keys(buildings).length > 0 ? buildings : null);
        if (Object.keys(food).length > 0) rebuildFoodIcons(food, Object.keys(buildings).length > 0 ? buildings : null);
        map.triggerRepaint();
      });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(_gl: WebGLRenderingContext, args: any) {
      const t = Date.now() / 1000;

      updateTrains();
      updatePlanes(t);

      // ── Voice filter: animate building scale (sink / vanish / rise) ────────
      buildingGroups.forEach((group, i) => {
        const target  = targetScales[i]  ?? 1.0;
        const current = currentScales[i] ?? 1.0;
        const next    = current + (target - current) * 0.08; // smooth lerp
        currentScales[i] = next;
        group.scale.z = Math.max(next, 0.001);
        group.visible  = next > 0.01;
      });

      // Pulse spotlight beams
      spotlightBeams.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat?.transparent) {
          const base = i % 2 === 0 ? 0.08 : 0.22;
          mat.opacity = base + Math.sin(t * 2.5 + i * 0.7) * 0.05;
        }
      });

      // Bob food icons (hidden when their building is filtered out)
      foodIconGroups.forEach(({ outer, baseZ, restaurantIdx }, i) => {
        const visible = (currentScales[restaurantIdx] ?? 1) > 0.05;
        outer.visible = visible;
        if (visible) outer.position.z = baseZ + Math.sin(t * 1.5 + i * 0.8) * 5 * s;
      });

      // Float feature icons (vertical planes; bob along Z, billboard via map bearing).
      const bearingRad = (map.getBearing() * Math.PI) / 180;
      featureMarkers.forEach(({ mesh, baseZ, bobOffset, restaurantIdx }) => {
        const visible = (currentScales[restaurantIdx] ?? 1) > 0.05;
        mesh.visible = visible;
        if (visible) {
          mesh.position.z = baseZ + Math.sin(t * 1.2 + bobOffset) * 1.8 * s;
          mesh.rotation.z = bearingRad;
        }
      });

      // Pulse trending beacons (hidden when their building is filtered out)
      trendingBeacons.forEach(({ group, restaurantIdx }, i) => {
        const visible = (currentScales[restaurantIdx] ?? 1) > 0.05;
        group.visible = visible;
        if (!visible) return;
        group.children.forEach((child, ci) => {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat?.transparent) {
            mat.opacity = (ci === 0 ? 0.08 : 0.22) + Math.sin(t * 2.2 + i) * 0.08;
          }
        });
      });

      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(refMerc.x, refMerc.y, refMerc.z);
      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };

  return { layer, setFilter };
}
