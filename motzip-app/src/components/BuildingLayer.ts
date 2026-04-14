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
  if (rating >= 4.5) return new THREE.Color(0.6, 0.45, 0.0);
  if (rating >= 4.0) return new THREE.Color(0.4, 0.25, 0.0);
  if (rating >= 3.5) return new THREE.Color(0.2, 0.08, 0.0);
  return new THREE.Color(0.1, 0.02, 0.0);
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
    emissiveIntensity: 0.3 + metalBoost * 0.2,
    metalness: Math.min(1, (rating >= 4.5 ? 0.6 : 0.2) + metalBoost),
    roughness: Math.max(0.1, (rating >= 4.5 ? 0.3 : 0.7) - metalBoost),
    side: THREE.BackSide,
  });
}

function makeTopMat(rating: number, premium = false) {
  return new THREE.MeshStandardMaterial({
    color:   premium ? new THREE.Color("#FFD700") : new THREE.Color("#ffffff"),
    emissive: premium ? new THREE.Color(0.8, 0.6, 0.0) : ratingToEmissiveColor(rating),
    emissiveIntensity: premium ? 0.4 : 0.15,
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
      const ds = (mat: THREE.Material) => { mat.side = THREE.DoubleSide; };
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
  let inner: THREE.Group;

  if (tier === "landmark") {
    const tpl = models?.[`landmark_${r.category}` as LandmarkModelKey] ?? models?.["building_major"];
    inner = tpl ? placeGlbModel(tpl, 35 * s, r.reviewCount * 1.2 * s) : buildProceduralLandmark(r, s);
  } else if (tier === "major") {
    inner = models?.["building_major"] ? placeGlbModel(models["building_major"]!, 26 * s, r.reviewCount * 0.9 * s) : buildProceduralMajor(r, s);
  } else if (tier === "mid") {
    inner = models?.["building_mid"] ? placeGlbModel(models["building_mid"]!, 18 * s, r.reviewCount * 0.7 * s) : buildProceduralMid(r, s);
  } else {
    const hM = Math.max(30, r.reviewCount * 0.6), bM = 12 + Math.min(r.reviewCount * 0.01, 8);
    inner = models?.["building_regular"] ? placeGlbModel(models["building_regular"]!, bM * s, hM * s) : buildProceduralRegular(r, s);
  }
  outer.add(inner);
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
// Each restaurant feature is shown as a small glowing octahedron (gem) floating
// just above the ground beside the building. Multiple features = a compact row
// of gems. A trending building also gets a vertical light-beam column.
//
// Gem color guide:
//   orange = Trending   sky-blue = Wheelchair   green = Free parking
//   blue   = Paid park  gold     = Valet         purple = Live music
//   lime   = Dogs       pink     = Cocktails

interface FeatureMarker {
  mesh: THREE.Mesh;
  baseZ: number;
  bobOffset: number;
}

/** Small glowing octahedron (diamond-shaped gem) */
function createFeatureGem(color: string, emissiveColor: string, s: number): THREE.Mesh {
  const geo = new THREE.OctahedronGeometry(2.2 * s);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: emissiveColor,
    emissiveIntensity: 1.0,
    metalness: 0.5,
    roughness: 0.15,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Vertical light-beam column for trending buildings.
 * Two concentric cones: outer translucent glow + inner bright core.
 */
function createTrendingBeacon(topZ: number, s: number): THREE.Group {
  const group = new THREE.Group();
  const h = topZ + 40 * s;

  // Outer wide cone
  const outerGeo = new THREE.CylinderGeometry(0.8 * s, 10 * s, h, 8, 1, true);
  outerGeo.rotateX(Math.PI / 2);
  outerGeo.translate(0, 0, h / 2);
  group.add(new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({
    color: "#ff6600", emissive: "#ff4400", emissiveIntensity: 0.5,
    transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  })));

  // Inner narrow core
  const innerGeo = new THREE.CylinderGeometry(0.3 * s, 3 * s, h, 6, 1, true);
  innerGeo.rotateX(Math.PI / 2);
  innerGeo.translate(0, 0, h / 2);
  group.add(new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({
    color: "#ffaa00", emissive: "#ff8800", emissiveIntensity: 1.0,
    transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false,
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
  let foodIconGroups: { outer: THREE.Group; baseZ: number }[] = [];
  let featureMarkers: FeatureMarker[] = [];
  let trendingBeacons: THREE.Group[] = [];

  // ── Voice filter state ─────────────────────────────────────────────────────
  let filteredIds: Set<string> | null = null;
  const targetScales: number[] = [];   // target scale.z per building index
  const currentScales: number[] = [];  // current animated scale.z
  let spotlightBeams: THREE.Mesh[] = [];

  const buildingTopZMap = new Map<string, number>();

  // ── Feature markers ────────────────────────────────────────────────────────

  function rebuildGroundIndicators() {
    featureMarkers.forEach(({ mesh }) => scene.remove(mesh));
    trendingBeacons.forEach((g) => scene.remove(g));
    featureMarkers = [];
    trendingBeacons = [];

    restaurants.forEach((r, ri) => {
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const bx    = merc.x - refMerc.x;
      const by    = merc.y - refMerc.y;
      const baseW = getBuildingBaseW(r, s);

      // Collect active features in priority order
      const features: { color: string; emissive: string }[] = [];
      if (r.isTrending)              features.push({ color: "#ff8c00", emissive: "#ff4400" });
      if (r.isWheelchairAccessible)  features.push({ color: "#00bfff", emissive: "#007fff" });
      if (r.parkingType === "free")  features.push({ color: "#22c55e", emissive: "#15803d" });
      if (r.parkingType === "paid")  features.push({ color: "#60a5fa", emissive: "#1d4ed8" });
      if (r.parkingType === "valet") features.push({ color: "#f59e0b", emissive: "#b45309" });
      if (r.hasLiveMusic)            features.push({ color: "#a855f7", emissive: "#7c3aed" });
      if (r.allowsDogs)              features.push({ color: "#4ade80", emissive: "#16a34a" });
      if (r.servesCocktails)         features.push({ color: "#ec4899", emissive: "#be185d" });

      if (features.length > 0) {
        const gemR    = 2.2 * s;
        const spacing = gemR * 3.0;
        const startX  = bx + baseW * 0.72;
        const startY  = by + baseW * 0.72;
        // Center the row around the diagonal offset
        const rowOffset = ((features.length - 1) * spacing) / 2;

        features.forEach((feat, fi) => {
          const mesh = createFeatureGem(feat.color, feat.emissive, s);
          mesh.position.set(
            startX + fi * spacing - rowOffset,
            startY,
            gemR + 1.5 * s,
          );
          scene.add(mesh);
          featureMarkers.push({ mesh, baseZ: gemR + 1.5 * s, bobOffset: ri * 0.9 + fi * 0.5 });
        });
      }

      // Trending → vertical light-beam column
      if (r.isTrending) {
        const topZ   = buildingTopZMap.get(r.id) ?? 50 * s;
        const beacon = createTrendingBeacon(topZ, s);
        beacon.position.set(bx, by, 0);
        scene.add(beacon);
        trendingBeacons.push(beacon);
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
      buildingTopZMap.set(r.id, new THREE.Box3().setFromObject(g).max.z);
    }

    rebuildGroundIndicators();

    // Init scale arrays
    restaurants.forEach((_, i) => {
      targetScales[i]  = filteredIds === null ? 1.0 : (filteredIds.has(restaurants[i].id) ? 1.0 : 0.05);
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
        targetScales[i] = 0.04;
      }
    });
  }

  function rebuildFoodIcons(food: FoodModels, buildings: BuildingModels | null) {
    foodIconGroups.forEach(({ outer }) => scene.remove(outer));
    foodIconGroups = [];
    const SIZE = 14 * s, GAP = 6 * s;

    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const template = food[r.category];
      if (!template) continue;
      const tier = getBuildingTier(r.reviewCount, r.rating);
      if (tier === "landmark" && buildings?.[`landmark_${r.category}` as LandmarkModelKey]) continue;

      const topZ  = new THREE.Box3().setFromObject(buildingGroups[i]).max.z;
      const icon  = placeGlbModel(template, SIZE, SIZE);
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const outer = new THREE.Group();
      outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, topZ + GAP);
      outer.add(icon);
      scene.add(outer);
      foodIconGroups.push({ outer, baseZ: topZ + GAP });
    }
  }

  // ── Layer interface ────────────────────────────────────────────────────────

  const layer: maplibregl.CustomLayerInterface = {
    id: "3d-buildings",
    type: "custom",
    renderingMode: "3d",

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 3.0));
      const dir = new THREE.DirectionalLight(0xffeedd, 2.5); dir.position.set(0.5, -0.3, 1.0); scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0x8888ff, 1.0); dir2.position.set(-0.3, 0.5, 0.8); scene.add(dir2);

      rebuildBuildings(null);

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

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
      pmrem.dispose();

      const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
      const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
      Promise.all([loadBuildingModels(loader), loadFoodModels(loader)]).then(([buildings, food]) => {
        if (Object.keys(buildings).length > 0) rebuildBuildings(buildings);
        if (Object.keys(food).length > 0)      rebuildFoodIcons(food, buildings);
        map.triggerRepaint();
      });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(_gl: WebGLRenderingContext, args: any) {
      const t = Date.now() / 1000;

      // ── Voice filter: animate building scale (sink / rise) ─────────────────
      buildingGroups.forEach((group, i) => {
        const target  = targetScales[i]  ?? 1.0;
        const current = currentScales[i] ?? 1.0;
        const next    = current + (target - current) * 0.08; // smooth lerp
        currentScales[i] = next;
        group.scale.z = next;
        // Fade gem markers for dimmed buildings
        if (featureMarkers[i]) {
          const mat = featureMarkers[i].mesh.material as THREE.MeshStandardMaterial;
          if (mat) mat.opacity = Math.max(0.05, next);
        }
      });

      // Pulse spotlight beams
      spotlightBeams.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat?.transparent) {
          const base = i % 2 === 0 ? 0.08 : 0.22;
          mat.opacity = base + Math.sin(t * 2.5 + i * 0.7) * 0.05;
        }
      });

      // Bob food icons
      foodIconGroups.forEach(({ outer, baseZ }, i) => {
        outer.position.z = baseZ + Math.sin(t * 1.5 + i * 0.8) * 5 * s;
      });

      // Float + spin feature gems
      featureMarkers.forEach(({ mesh, baseZ, bobOffset }) => {
        mesh.position.z = baseZ + Math.sin(t * 1.2 + bobOffset) * 1.8 * s;
        mesh.rotation.z += 0.007;
      });

      // Pulse trending beacons
      trendingBeacons.forEach((group, i) => {
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
