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

export function getBuildingTier(reviewCount: number, rating: number): "landmark" | "major" | "mid" | "regular" {
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

function createBuildingGroup(r: Restaurant, refMerc: maplibregl.MercatorCoordinate, _s: number, _models: BuildingModels | null): THREE.Group {
  // Buildings are intentionally empty — every restaurant renders as a floating food icon only.
  // Group is kept (positioned at the restaurant) so per-restaurant indexing stays in sync
  // across buildingGroups / foodIconGroups / voice filter scaling.
  const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
  const outer = new THREE.Group();
  outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, 0);
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
    loader.load(`/models/food/${cat}.glb`, (gltf) => {
      const root = gltf.scene as THREE.Group;
      // Boost color saturation once on the template — clones share these materials.
      const hsl = { h: 0, s: 0, l: 0 };
      root.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const bump = (m: THREE.Material) => {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.color) return;
          std.color.getHSL(hsl);
          std.color.setHSL(hsl.h, Math.min(1, hsl.s * 3.0), hsl.l);
        };
        Array.isArray(mesh.material) ? mesh.material.forEach(bump) : mesh.material && bump(mesh.material);
      });
      models[cat] = root;
      resolve();
    }, undefined, () => resolve());
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
  const size = 4.5 * s;
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
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
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
  let foodIconGroups: {
    outer: THREE.Group;
    baseZ: number;
    restaurantIdx: number;
    label?: THREE.Mesh;
    labelOffsetZ?: number;     // per-restaurant — sits on top of the beam
    beam?: THREE.Mesh;
    beamPhase?: number;
  }[] = [];
  let featureMarkers: FeatureMarker[] = [];
  let trendingBeacons: { group: THREE.Group; restaurantIdx: number }[] = [];

  // ── Voice filter state ─────────────────────────────────────────────────────
  let filteredIds: Set<string> | null = null;
  const targetScales: number[] = [];   // target scale.z per building index
  const currentScales: number[] = [];  // current animated scale.z
  let spotlightBeams: THREE.Mesh[] = [];

  const buildingTopZMap = new Map<string, number>();

  // ── Crowd state — toon-outlined 3D people scaled by restaurant popularity ──
  const peopleGroup = new THREE.Group();
  interface PersonMover {
    mesh: THREE.Group;
    baseX: number; baseY: number;
    heading: number;     // facing direction (toward front of line)
    bobPhase: number;
    swayPhase: number;
    restaurantIdx: number;
  }
  const people: PersonMover[] = [];

  const PERSON_SHIRT_COLORS = [
    "#ef4444", "#3b82f6", "#22c55e", "#eab308",
    "#a855f7", "#ec4899", "#14b8a6", "#f97316",
    "#0ea5e9", "#84cc16",
  ];
  const PERSON_HEAD_COLORS = ["#a07a52", "#7a553a", "#5b3c25", "#3d2615"];
  const PERSON_PANTS_COLORS = ["#1f2937", "#3b3b3b", "#4b5563", "#1e3a8a", "#365314", "#1c1917"];

  // Shared geometries — torso/limbs are cylinders rotated so axis runs along Z.
  const cyl = (rT: number, rB: number, h: number, seg = 8) => {
    const g = new THREE.CylinderGeometry(rT, rB, h, seg);
    g.rotateX(Math.PI / 2);
    return g;
  };
  const PERSON_TORSO_GEO = cyl(0.5, 0.6, 1.2, 10);
  const PERSON_LEG_GEO   = cyl(0.22, 0.28, 1.4, 8);
  const PERSON_ARM_GEO   = cyl(0.18, 0.22, 1.1, 8);
  const PERSON_HEAD_GEO  = new THREE.SphereGeometry(0.55, 10, 8);

  // Shared edges for toon outline
  const PERSON_TORSO_EDGES = new THREE.EdgesGeometry(PERSON_TORSO_GEO, 25);
  const PERSON_LEG_EDGES   = new THREE.EdgesGeometry(PERSON_LEG_GEO, 25);
  const PERSON_ARM_EDGES   = new THREE.EdgesGeometry(PERSON_ARM_GEO, 25);
  const PERSON_HEAD_EDGES  = new THREE.EdgesGeometry(PERSON_HEAD_GEO, 25);
  const PERSON_LINE_MAT    = new THREE.LineBasicMaterial({ color: 0x000000 });

  function makePerson(): THREE.Group {
    const g = new THREE.Group();
    const shirt = PERSON_SHIRT_COLORS[Math.floor(Math.random() * PERSON_SHIRT_COLORS.length)];
    const head  = PERSON_HEAD_COLORS[Math.floor(Math.random() * PERSON_HEAD_COLORS.length)];
    const pants = PERSON_PANTS_COLORS[Math.floor(Math.random() * PERSON_PANTS_COLORS.length)];
    const shirtCol = new THREE.Color(shirt);
    const headCol  = new THREE.Color(head);
    const pantsCol = new THREE.Color(pants);

    const shirtMat = new THREE.MeshStandardMaterial({
      color: shirtCol,
      emissive: shirtCol.clone().multiplyScalar(0.15),
      roughness: 0.65, metalness: 0.05,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: pantsCol, roughness: 0.8,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: headCol, roughness: 0.85,
    });

    const addPart = (
      geo: THREE.BufferGeometry,
      edges: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number, y: number, z: number,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      const e = new THREE.LineSegments(edges, PERSON_LINE_MAT);
      e.position.set(x, y, z);
      g.add(e);
    };

    // Legs (z=0..1.4, centered at 0.7)
    addPart(PERSON_LEG_GEO, PERSON_LEG_EDGES, pantsMat, -0.28, 0, 0.7);
    addPart(PERSON_LEG_GEO, PERSON_LEG_EDGES, pantsMat,  0.28, 0, 0.7);

    // Torso (z=1.4..2.6, centered at 2.0)
    addPart(PERSON_TORSO_GEO, PERSON_TORSO_EDGES, shirtMat, 0, 0, 2.0);

    // Arms hanging at sides (z=1.4..2.5, centered at 1.95)
    addPart(PERSON_ARM_GEO, PERSON_ARM_EDGES, shirtMat, -0.7, 0, 1.95);
    addPart(PERSON_ARM_GEO, PERSON_ARM_EDGES, shirtMat,  0.7, 0, 1.95);

    // Head (sphere centered at 3.1)
    addPart(PERSON_HEAD_GEO, PERSON_HEAD_EDGES, headMat, 0, 0, 3.1);

    return g;
  }

  function getCrowdSize(r: Restaurant): number {
    // Most ratings cluster at 4.0~4.7, so we stretch that range across the
    // full 0~5 ladder for dramatic visual contrast. reviewCount nudges the
    // top end so a 4.7-rated place with very few reviews stays at 4.
    if (r.rating >= 4.7 && r.reviewCount >= 500) return 5;
    if (r.rating >= 4.5) return 4;
    if (r.rating >= 4.3) return 3;
    if (r.rating >= 4.1) return 2;
    if (r.rating >= 3.9) return 1;
    return 0;
  }

  function populatePeople() {
    people.forEach((p) => peopleGroup.remove(p.mesh));
    people.length = 0;

    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const count = getCrowdSize(r);
      if (count === 0) continue;

      const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const cx = merc.x - refMerc.x;
      const cy = merc.y - refMerc.y;

      // Queue: people stand in line waiting for the restaurant.
      // Line direction is random per restaurant, head of the line near the food.
      const lineHeading = Math.random() * Math.PI * 2;          // direction the line extends away from the food
      const dirX = Math.cos(lineHeading);
      const dirY = Math.sin(lineHeading);
      const headingFace = lineHeading + Math.PI;                // people face back toward food
      const startDist = 18 * s;
      const spacing = 10 * s;

      for (let k = 0; k < count; k++) {
        const person = makePerson();
        person.scale.setScalar(s * 2.8);
        const dist = startDist + k * spacing;
        const baseX = cx + dirX * dist;
        const baseY = cy + dirY * dist;
        person.position.set(baseX, baseY, 0);
        person.rotation.z = headingFace;
        peopleGroup.add(person);
        people.push({
          mesh: person,
          baseX, baseY,
          heading: headingFace,
          bobPhase: Math.random() * Math.PI * 2,
          swayPhase: Math.random() * Math.PI * 2,
          restaurantIdx: i,
        });
      }
    }
  }

  // ── Highlight state (hover/selected) ───────────────────────────────────────
  let hoveredId: string | null = null;
  let selectedId: string | null = null;
  const hlMatCache = new Map<string, {
    mat: THREE.MeshStandardMaterial;
    origColor: THREE.Color;
    origIntensity: number;
  }[]>();
  let prevHighlighted = new Set<string>();

  // ── Feature markers ────────────────────────────────────────────────────────

  function rebuildGroundIndicators() {
    featureMarkers.forEach(({ mesh }) => scene.remove(mesh));
    trendingBeacons.forEach(({ group }) => scene.remove(group));
    featureMarkers = [];
    trendingBeacons = [];

    // Feature icon row sits just below the per-restaurant name label.
    const ICON_SPACING = 5.5 * s;
    const FEATURE_BELOW_LABEL = 5 * s;

    restaurants.forEach((r, ri) => {
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const bx    = merc.x - refMerc.x;
      const by    = merc.y - refMerc.y;

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
        const rowOffset = ((features.length - 1) * ICON_SPACING) / 2;
        const featureZ = getLabelOffsetZ(r) - FEATURE_BELOW_LABEL;

        features.forEach((key, fi) => {
          const mesh = createFeatureIcon(key, s);
          mesh.position.set(
            bx + fi * ICON_SPACING - rowOffset,
            by,
            featureZ,
          );
          scene.add(mesh);
          featureMarkers.push({ mesh, baseZ: featureZ, bobOffset: ri * 0.9 + fi * 0.5, restaurantIdx: ri });
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
    // Highlight cache references the now-removed materials
    hlMatCache.clear();
    prevHighlighted = new Set();

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
        // Sink completely. Render loop hides the group entirely once it
        // shrinks below threshold so the bottom face also disappears.
        targetScales[i] = 0;
      }
    });
  }

  function makeNameLabel(name: string, r: Restaurant): THREE.Mesh {
    // Higher rating → bolder + larger + darker text.
    let weight: number, fontPx: number, planeH: number, color: string;
    if (r.rating >= 4.5)      { weight = 700; fontPx = 64; planeH = 9.5 * s; color = "#000000"; }
    else if (r.rating >= 4.2) { weight = 500; fontPx = 50; planeH = 7.5 * s; color = "#1c1c1c"; }
    else                       { weight = 400; fontPx = 38; planeH = 6   * s; color = "#3a3a3a"; }

    const FONT = `${weight} ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const measureCanvas = document.createElement("canvas");
    const measureCtx = measureCanvas.getContext("2d")!;
    measureCtx.font = FONT;
    const textW = measureCtx.measureText(name).width;
    const padX = 24;
    const canvasH = Math.round(fontPx * 1.5);
    const w = Math.max(120, Math.ceil(textW) + padX * 2);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(name, w / 2, canvasH / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const planeW = planeH * (w / canvasH);
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    geo.rotateX(Math.PI / 2);  // stand vertical, normal → +Y
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.05,
      side: THREE.DoubleSide, depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  // Thin upward light shaft emitted from the top of each food model.
  function makeFoodBeam(h: number, color: number): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(0.5 * s, 0.7 * s, h, 8, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, h / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  function getBeamColor(r: Restaurant): number {
    if (r.rating >= 4.5) return 0xb8861a;  // deep gold
    if (r.rating >= 4.2) return 0x6e7280;  // dark steel silver
    return 0x7a3f15;                        // deep bronze
  }

  function getBeamHeight(r: Restaurant): number {
    if (r.rating >= 4.7 && r.reviewCount >= 500) return 60 * s;
    if (r.rating >= 4.5) return 45 * s;
    if (r.rating >= 4.3) return 33 * s;
    if (r.rating >= 4.1) return 23 * s;
    if (r.rating >= 3.9) return 14 * s;
    return 7 * s;
  }
  // Shared anchor — base of beam (top of food)
  const BEAM_BASE_Z_CONST = 22;
  function getLabelOffsetZ(r: Restaurant): number {
    return BEAM_BASE_Z_CONST * s + getBeamHeight(r) + 4 * s;
  }

  function rebuildFoodIcons(food: FoodModels) {
    foodIconGroups.forEach(({ outer, label }) => {
      scene.remove(outer);
      if (label) scene.remove(label);
    });
    foodIconGroups = [];
    const SIZE = 22 * s;
    const BEAM_BASE_Z = 22 * s;     // start beam from top of food

    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const template = food[r.category];
      if (!template) continue;

      const icon  = placeGlbModel(template, SIZE, SIZE);
      const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const cx = merc.x - refMerc.x;
      const cy = merc.y - refMerc.y;
      const outer = new THREE.Group();
      // Sit the food flat on the ground (placeGlbModel already aligns min.z to 0).
      outer.position.set(cx, cy, 0);
      outer.add(icon);

      // Light shaft above the food (parented so it sinks/rises with it).
      const beamH = getBeamHeight(r);
      const beam = makeFoodBeam(beamH, getBeamColor(r));
      beam.position.z = BEAM_BASE_Z;
      outer.add(beam);

      scene.add(outer);

      // Label sits at the top of the beam (per-restaurant offset)
      const labelOffsetZ = getLabelOffsetZ(r);
      const label = makeNameLabel(r.name, r);
      label.position.set(cx, cy, labelOffsetZ);
      scene.add(label);

      foodIconGroups.push({
        outer, baseZ: 0, restaurantIdx: i, label, labelOffsetZ,
        beam, beamPhase: Math.random() * Math.PI * 2,
      });
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
    mats: THREE.Material[];   // per-train materials so opacity is independent
    opacity: number;          // current animated opacity 0..1
    fadingOut: boolean;       // when true, opacity ramps to 0 then we dispose
  }
  const trains: TrainMover[] = [];

  function collectTrainMats(g: THREE.Group): THREE.Material[] {
    const out: THREE.Material[] = [];
    g.traverse((c) => {
      if (!(c as THREE.Mesh).isMesh) return;
      const mesh = c as THREE.Mesh;
      const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      arr.forEach((m) => {
        if (!m) return;
        const mat = m as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0;          // start invisible — fade-in driven by render loop
        mat.depthWrite = false;
        out.push(mat);
      });
    });
    return out;
  }

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
    const layersInStyle = TRAIN_LAYER_IDS.filter((id) => map.getLayer(id));
    if (layersInStyle.length === 0) return;

    let features: maplibregl.MapGeoJSONFeature[];
    try {
      features = map.queryRenderedFeatures({ layers: layersInStyle });
    } catch { return; }
    if (features.length === 0) return;

    // Mark existing trains for fade-out instead of yanking them — the render
    // loop will dispose them once they finish fading.
    trains.forEach((t) => { t.fadingOut = true; });
    placedRailwayKeys.clear();

    // Fisher–Yates shuffle so the cap-many we keep are sampled uniformly.
    for (let i = features.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [features[i], features[j]] = [features[j], features[i]];
    }

    let added = 0;
    for (const f of features) {
      if (added >= TRAIN_CAP) break;
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
          mats: collectTrainMats(train),
          opacity: 0,
          fadingOut: false,
        });
        added++;
      }
    }
  }

  let lastTrainT = Date.now() / 1000;
  function updateTrains() {
    const now = Date.now() / 1000;
    const dt = Math.min(0.1, now - lastTrainT);
    lastTrainT = now;
    // Fade speed (per second) — converted via dt so it's frame-rate independent
    const FADE_PER_SEC = 1.6;

    for (let i = trains.length - 1; i >= 0; i--) {
      const t = trains[i];
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

      // Fade in/out
      const target = t.fadingOut ? 0 : 1;
      const step = FADE_PER_SEC * dt;
      t.opacity += Math.sign(target - t.opacity) * Math.min(step, Math.abs(target - t.opacity));
      for (const m of t.mats) (m as THREE.MeshStandardMaterial).opacity = t.opacity;

      // Dispose once fully faded out
      if (t.fadingOut && t.opacity <= 0.001) {
        trainGroup.remove(t.group);
        t.mats.forEach((m) => m.dispose());
        trains.splice(i, 1);
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
      color: "#101010", emissive: "#000000", emissiveIntensity: 0,
      metalness: 0.7, roughness: 0.3, side: THREE.BackSide,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: "#1a1a1a", emissive: "#000000", emissiveIntensity: 0,
      metalness: 0.6, roughness: 0.35, side: THREE.BackSide,
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
      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const dir = new THREE.DirectionalLight(0xfff0d0, 2.4); dir.position.set(0.5, -0.3, 1.0); scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0xaab0ff, 0.7); dir2.position.set(-0.3, 0.5, 0.8); scene.add(dir2);

      scene.add(treeGroup);
      scene.add(trainGroup);
      scene.add(planeGroup);
      scene.add(peopleGroup);
      populatePeople();
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
      scene.environmentIntensity = 0.8;
      pmrem.dispose();

      // Soft sky/ground hemisphere fill — natural daytime feel
      scene.add(new THREE.HemisphereLight(0xc8dfff, 0xfff0d0, 0.5));

      const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
      const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
      Promise.all([loadBuildingModels(loader), loadFoodModels(loader)]).then(([buildings, food]) => {
        rebuildBuildings(Object.keys(buildings).length > 0 ? buildings : null);
        if (Object.keys(food).length > 0) rebuildFoodIcons(food);
        map.triggerRepaint();
      });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(_gl: WebGLRenderingContext, args: any) {
      const t = Date.now() / 1000;

      updateTrains();
      updatePlanes(t);

      // Queue — people wait in line, swaying side-to-side and shifting weight
      for (const p of people) {
        const buildingScale  = currentScales[p.restaurantIdx] ?? 1;
        const buildingTarget = targetScales[p.restaurantIdx]  ?? 1;
        const visible = buildingScale > 0.02 || buildingTarget > 0.02;
        p.mesh.visible = visible;
        if (!visible) continue;

        // Sway perpendicular to line direction (sideways shuffle)
        const perpX = -Math.sin(p.heading);
        const perpY =  Math.cos(p.heading);
        const sway  = Math.sin(t * 1.3 + p.swayPhase) * 0.35 * s;
        p.mesh.position.x = p.baseX + perpX * sway;
        p.mesh.position.y = p.baseY + perpY * sway;
        // Slight foot tap / weight shift — gentle vertical bob
        p.mesh.position.z = Math.abs(Math.sin(t * 2.0 + p.bobPhase)) * 0.18 * s;
        p.mesh.rotation.z = p.heading;
      }

      // ── Voice filter: animate building scale (sink / vanish / rise) ────────
      // VISIBLE_THRESHOLD: once the lerp gets close enough to zero, hide the
      // entire group so the bottom face/footprint vanishes too. When un-
      // filtering we restore visibility before animating back up.
      const VISIBLE_THRESHOLD = 0.02;
      buildingGroups.forEach((group, i) => {
        const target  = targetScales[i]  ?? 1.0;
        const current = currentScales[i] ?? 1.0;
        let next      = current + (target - current) * 0.18; // faster lerp
        if (Math.abs(target - next) < 0.01) next = target;   // snap to end so spin stops
        currentScales[i] = next;
        group.scale.z = Math.max(next, 0.0001); // three.js dislikes scale=0
        group.visible = next > VISIBLE_THRESHOLD || target > VISIBLE_THRESHOLD;
      });

      // Pulse spotlight beams
      spotlightBeams.forEach((mesh, i) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat?.transparent) {
          const base = i % 2 === 0 ? 0.08 : 0.22;
          mat.opacity = base + Math.sin(t * 2.5 + i * 0.7) * 0.05;
        }
      });

      // Food icons — sit on the ground; when filtered out they spin and sink
      // below ground, when filtered back in they rise + spin back up.
      const SINK_Z = -40 * s;
      const labelBearingRad = (map.getBearing() * Math.PI) / 180;
      foodIconGroups.forEach(({ outer, baseZ, restaurantIdx, label, labelOffsetZ, beam, beamPhase }) => {
        const scale  = currentScales[restaurantIdx] ?? 1;
        const target = targetScales[restaurantIdx]  ?? 1;
        const visible = scale > 0.01 || target > 0.01;
        outer.visible = visible;
        if (label) label.visible = visible;
        if (!visible) return;

        // Lerp between sunk and ground-resting positions
        const z = SINK_Z + (baseZ - SINK_Z) * scale;
        outer.position.z = z;

        // Spin while sinking/rising; rest when fully present
        const spinFactor = (1 - scale) * (1 - scale);
        outer.rotation.z = t * 1.67 * spinFactor;

        // Label sits at the top of the beam (per-restaurant offset),
        // billboarded toward camera, no spin.
        if (label && labelOffsetZ !== undefined) {
          label.position.z = z + labelOffsetZ;
          label.rotation.z = labelBearingRad;
        }

        // Sparkle on the metal beam — sharp brief flashes punctuate a base glow
        if (beam && beamPhase !== undefined) {
          const flash = Math.pow(Math.abs(Math.sin(t * 3.5 + beamPhase)), 6);
          (beam.material as THREE.MeshBasicMaterial).opacity = 0.8 + flash * 0.2;
        }
      });

      // Float feature icons (vertical planes; bob along Z, billboard via map bearing).
      const bearingRad = (map.getBearing() * Math.PI) / 180;
      featureMarkers.forEach(({ mesh, baseZ, bobOffset, restaurantIdx }) => {
        const buildingScale = currentScales[restaurantIdx] ?? 1;
        const buildingTarget = targetScales[restaurantIdx] ?? 1;
        const visible = buildingScale > VISIBLE_THRESHOLD || buildingTarget > VISIBLE_THRESHOLD;
        mesh.visible = visible;
        if (visible) {
          mesh.position.z = baseZ + Math.sin(t * 1.2 + bobOffset) * 1.8 * s;
          mesh.rotation.z = bearingRad;
        }
      });

      // Pulse trending beacons (hidden when their building is filtered out)
      trendingBeacons.forEach(({ group, restaurantIdx }, i) => {
        const buildingScale = currentScales[restaurantIdx] ?? 1;
        const buildingTarget = targetScales[restaurantIdx] ?? 1;
        const visible = buildingScale > VISIBLE_THRESHOLD || buildingTarget > VISIBLE_THRESHOLD;
        group.visible = visible;
        if (!visible) return;
        group.children.forEach((child, ci) => {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat?.transparent) {
            mat.opacity = (ci === 0 ? 0.08 : 0.22) + Math.sin(t * 2.2 + i) * 0.08;
          }
        });
      });

      // Hover/selected glow pulse on cloned materials
      applyHighlights(t);

      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(refMerc.x, refMerc.y, refMerc.z);
      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };

  // ── Hover/select highlight ─────────────────────────────────────────────────
  // Materials in cloned GLB groups are shared by reference, so we clone-on-demand
  // the first time a restaurant is highlighted, then drive the cloned material's
  // emissiveIntensity from the render loop (sin pulse).

  interface HlEntry {
    mat: THREE.MeshStandardMaterial;
    origColor: THREE.Color;
    origIntensity: number;
  }

  const HIGHLIGHT_COLOR = new THREE.Color(0xffd060); // warm gold edge glow

  function collectHighlightMats(idx: number): HlEntry[] {
    const out: HlEntry[] = [];
    const targets: THREE.Object3D[] = [];
    if (buildingGroups[idx]) targets.push(buildingGroups[idx]);
    const food = foodIconGroups.find((e) => e.restaurantIdx === idx);
    if (food) targets.push(food.outer);

    for (const root of targets) {
      root.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const swap = (m: THREE.Material): THREE.Material => {
          const std = m as THREE.MeshStandardMaterial;
          if (std.emissive === undefined) return m;
          const cloned = std.clone();
          out.push({
            mat: cloned,
            origColor: cloned.emissive.clone(),
            origIntensity: cloned.emissiveIntensity ?? 0,
          });
          return cloned;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(swap);
        } else if (mesh.material) {
          mesh.material = swap(mesh.material);
        }
      });
    }
    return out;
  }

  function applyHighlights(t: number) {
    const newSet = new Set<string>();
    if (hoveredId) newSet.add(hoveredId);
    if (selectedId) newSet.add(selectedId);

    // Restore materials that just left the highlighted set
    for (const id of prevHighlighted) {
      if (newSet.has(id)) continue;
      const mats = hlMatCache.get(id);
      if (!mats) continue;
      for (const e of mats) {
        e.mat.emissive.copy(e.origColor);
        e.mat.emissiveIntensity = e.origIntensity;
      }
    }

    // Pulse 0..1; at the dim phase emissive is near 0 so the texture stays visible.
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    for (const id of newSet) {
      let mats = hlMatCache.get(id);
      if (!mats) {
        const idx = restaurants.findIndex((r) => r.id === id);
        if (idx < 0) continue;
        mats = collectHighlightMats(idx);
        hlMatCache.set(id, mats);
      }
      for (const e of mats) {
        e.mat.emissive.copy(HIGHLIGHT_COLOR);
        e.mat.emissiveIntensity = pulse * 0.3;
      }
    }

    prevHighlighted = newSet;
  }

  function setHovered(id: string | null) { hoveredId = id; }
  function setSelected(id: string | null) { selectedId = id; }

  return { layer, setFilter, setHovered, setSelected };
}
