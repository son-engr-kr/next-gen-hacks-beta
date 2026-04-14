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

  const cols = 4;
  const rows = 8;
  const winW = 8;
  const winH = 10;
  const padX = (width - cols * winW) / (cols + 1);
  const padY = (height - rows * winH) / (rows + 1);

  const warmColors = ["#ffeaa7", "#fdcb6e", "#f8e71c", "#fff3cd", "#ffe0b2"];
  const coolColors = ["#74b9ff", "#a29bfe", "#81ecec"];

  let rng = Math.round(rating * 1000) || 1;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = padX + col * (winW + padX);
      const y = padY + row * (winH + padY);
      const litChance = isTrending ? 0.85 : 0.4 + rating * 0.08;
      if (rand() < litChance) {
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

// Reference point
const REF_LNG = -71.058;
const REF_LAT = 42.355;

// Building tier based on review count AND rating
function getBuildingTier(reviewCount: number, rating: number): "landmark" | "major" | "mid" | "regular" {
  const score = reviewCount * rating;
  if (score >= 2000 && rating >= 4.5) return "landmark";
  if (score >= 1500 && rating >= 4.2) return "major";
  if (score >= 700) return "mid";
  return "regular";
}

function getBuildingBaseW(r: Restaurant, s: number): number {
  const tier = getBuildingTier(r.reviewCount, r.rating);
  if (tier === "landmark") return 35 * s;
  if (tier === "major") return 26 * s;
  if (tier === "mid") return 18 * s;
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
    color: premium ? new THREE.Color("#FFD700") : new THREE.Color("#ffffff"),
    emissive: premium ? new THREE.Color(0.8, 0.6, 0.0) : ratingToEmissiveColor(rating),
    emissiveIntensity: premium ? 0.4 : 0.15,
    metalness: premium ? 0.9 : 0.8,
    roughness: premium ? 0.1 : 0.2,
    side: THREE.BackSide,
  });
}

const bottomMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#111111"), side: THREE.BackSide });

function addBoxSection(
  group: THREE.Group,
  w: number, d: number, h: number, zBase: number,
  wallMat: THREE.Material, topMat: THREE.Material
) {
  const geo = new THREE.BoxGeometry(w, d, h);
  geo.translate(0, 0, zBase + h / 2);
  const mesh = new THREE.Mesh(geo, [wallMat, wallMat, wallMat, wallMat, topMat, bottomMat]);
  group.add(mesh);
  return zBase + h;
}

function addCylinderSection(
  group: THREE.Group,
  radiusBottom: number, radiusTop: number, h: number, zBase: number,
  mat: THREE.Material, topMat: THREE.Material, segments = 8
) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, zBase + h / 2);
  const mesh = new THREE.Mesh(geo, [mat, topMat, bottomMat]);
  group.add(mesh);
  return zBase + h;
}

// ── GLB model types ────────────────────────────────────────────────────────────

type TierModelKey = "building_regular" | "building_mid" | "building_major";
type LandmarkModelKey = `landmark_${Category}`;
type ModelKey = TierModelKey | LandmarkModelKey;

type BuildingModels = Partial<Record<ModelKey, THREE.Group>>;
type FoodModels = Partial<Record<Category, THREE.Group>>;

function placeGlbModel(
  template: THREE.Group,
  targetW: number,
  targetH: number,
): THREE.Group {
  const clone = template.clone(true);
  clone.rotation.x = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const scaleXY = targetW / Math.max(size.x, size.y);
  const scaleZ  = targetH / size.z;
  const sc = Math.min(scaleXY, scaleZ);
  clone.scale.setScalar(sc);
  const box2 = new THREE.Box3().setFromObject(clone);
  clone.position.z = -box2.min.z;
  clone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const applyDouble = (m: THREE.Material) => { m.side = THREE.DoubleSide; };
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(applyDouble);
      } else if (mesh.material) {
        applyDouble(mesh.material);
      }
    }
  });
  return clone;
}

// ── Procedural building builders ───────────────────────────────────────────────

function buildProceduralLandmark(r: Restaurant, s: number): THREE.Group {
  const group = new THREE.Group();
  const totalH = r.reviewCount * 1.2 * s;
  const baseW = 35 * s;

  const tex  = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating + 0.3, r.isTrending, 48, 96);

  const wall0 = makeWallMat(tex, r.rating);
  const top0  = makeTopMat(r.rating);
  let z = 0;
  z = addBoxSection(group, baseW, baseW, totalH * 0.15, z, wall0, top0);

  const wall1 = makeWallMat(tex, r.rating, 0.2);
  const top1  = makeTopMat(r.rating, true);
  z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.30, z, wall1, top1);

  const wall2  = makeWallMat(tex2, r.rating, 0.4);
  const tier2W = baseW * 0.5;
  const geo2   = new THREE.BoxGeometry(tier2W, tier2W, totalH * 0.25);
  geo2.translate(0, 0, z + totalH * 0.25 / 2);
  const mesh2 = new THREE.Mesh(geo2, [wall2, wall2, wall2, wall2, makeTopMat(r.rating, true), bottomMat]);
  mesh2.rotation.z = Math.PI / 4;
  group.add(mesh2);
  z += totalH * 0.25;

  const spireMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#FFD700"),
    emissive: new THREE.Color(1.0, 0.8, 0.2),
    emissiveIntensity: 0.6,
    metalness: 0.95,
    roughness: 0.05,
    side: THREE.BackSide,
  });
  addCylinderSection(group, baseW * 0.15, baseW * 0.02, totalH * 0.30, z, spireMat, spireMat, 6);

  return group;
}

function buildProceduralMajor(r: Restaurant, s: number): THREE.Group {
  const group  = new THREE.Group();
  const totalH = r.reviewCount * 0.9 * s;
  const baseW  = 26 * s;

  const tex  = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating, r.isTrending, 48, 96);

  const wall0 = makeWallMat(tex, r.rating);
  const top0  = makeTopMat(r.rating);
  let z = 0;

  z = addBoxSection(group, baseW, baseW, totalH * 0.4, z, wall0, top0);
  const wall1 = makeWallMat(tex2, r.rating, 0.15);
  z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.35, z, wall1, makeTopMat(r.rating));
  const wall2 = makeWallMat(tex, r.rating, 0.3);
  z = addBoxSection(group, baseW * 0.45, baseW * 0.45, totalH * 0.25, z, wall2, makeTopMat(r.rating, true));

  const antMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#cccccc"),
    metalness: 0.9, roughness: 0.1, side: THREE.BackSide,
  });
  addCylinderSection(group, baseW * 0.03, baseW * 0.01, totalH * 0.12, z, antMat, antMat, 4);

  return group;
}

function buildProceduralMid(r: Restaurant, s: number): THREE.Group {
  const group  = new THREE.Group();
  const totalH = r.reviewCount * 0.7 * s;
  const baseW  = 18 * s;

  const tex  = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating, r.isTrending, 48, 96);

  const wall0 = makeWallMat(tex, r.rating);
  let z = 0;

  z = addBoxSection(group, baseW, baseW, totalH * 0.55, z, wall0, makeTopMat(r.rating));
  const wall1 = makeWallMat(tex2, r.rating, 0.1);
  addBoxSection(group, baseW * 0.65, baseW * 0.65, totalH * 0.45, z, wall1, makeTopMat(r.rating));

  return group;
}

function buildProceduralRegular(r: Restaurant, s: number): THREE.Group {
  const group       = new THREE.Group();
  const hMeters     = Math.max(30, r.reviewCount * 0.6);
  const baseMeters  = 12 + Math.min(r.reviewCount * 0.01, 8);
  const w = baseMeters * s;
  const h = hMeters * s;

  const tex  = createWindowTexture(r.rating, r.isTrending);
  const wall = makeWallMat(tex, r.rating);
  addBoxSection(group, w, w, h, 0, wall, makeTopMat(r.rating));

  return group;
}

// ── Main building creator ──────────────────────────────────────────────────────

function createBuildingGroup(
  r: Restaurant,
  refMerc: maplibregl.MercatorCoordinate,
  s: number,
  models: BuildingModels | null,
): THREE.Group {
  const tier  = getBuildingTier(r.reviewCount, r.rating);
  const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);

  const outer = new THREE.Group();
  outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, 0);

  let inner: THREE.Group;

  if (tier === "landmark") {
    const modelKey = `landmark_${r.category}` as LandmarkModelKey;
    const template = models?.[modelKey] ?? models?.["building_major"];
    if (template) {
      const totalH = r.reviewCount * 1.2 * s;
      const baseW  = 35 * s;
      inner = placeGlbModel(template, baseW, totalH);
    } else {
      inner = buildProceduralLandmark(r, s);
    }

  } else if (tier === "major") {
    const template = models?.["building_major"];
    if (template) {
      const totalH = r.reviewCount * 0.9 * s;
      const baseW  = 26 * s;
      inner = placeGlbModel(template, baseW, totalH);
    } else {
      inner = buildProceduralMajor(r, s);
    }

  } else if (tier === "mid") {
    const template = models?.["building_mid"];
    if (template) {
      const totalH = r.reviewCount * 0.7 * s;
      const baseW  = 18 * s;
      inner = placeGlbModel(template, baseW, totalH);
    } else {
      inner = buildProceduralMid(r, s);
    }

  } else {
    const template = models?.["building_regular"];
    if (template) {
      const hMeters = Math.max(30, r.reviewCount * 0.6);
      const bMeters = 12 + Math.min(r.reviewCount * 0.01, 8);
      inner = placeGlbModel(template, bMeters * s, hMeters * s);
    } else {
      inner = buildProceduralRegular(r, s);
    }
  }

  outer.add(inner);
  return outer;
}

// ── Model loading ──────────────────────────────────────────────────────────────

const MODEL_KEYS: ModelKey[] = [
  "building_regular", "building_mid", "building_major",
  "landmark_burger", "landmark_pizza", "landmark_sushi", "landmark_ramen",
  "landmark_cafe",   "landmark_mexican", "landmark_italian", "landmark_chinese",
  "landmark_thai",   "landmark_steakhouse", "landmark_seafood", "landmark_bakery",
];

async function loadBuildingModels(loader: GLTFLoader): Promise<BuildingModels> {
  const models: BuildingModels = {};
  await Promise.allSettled(
    MODEL_KEYS.map(
      (key) =>
        new Promise<void>((resolve) => {
          loader.load(
            `/models/buildings/${key}.glb`,
            (gltf) => { models[key] = gltf.scene as THREE.Group; resolve(); },
            undefined,
            () => resolve(),
          );
        }),
    ),
  );
  return models;
}

const FOOD_CATEGORIES: Category[] = [
  "burger", "pizza", "sushi", "ramen", "cafe", "mexican",
  "italian", "chinese", "thai", "steakhouse", "seafood", "bakery",
];

async function loadFoodModels(loader: GLTFLoader): Promise<FoodModels> {
  const models: FoodModels = {};
  await Promise.allSettled(
    FOOD_CATEGORIES.map(
      (cat) =>
        new Promise<void>((resolve) => {
          loader.load(
            `/models/food/${cat}.glb`,
            (gltf) => { models[cat] = gltf.scene as THREE.Group; resolve(); },
            undefined,
            () => resolve(),
          );
        }),
    ),
  );
  return models;
}

// ── Orbiting icon system ───────────────────────────────────────────────────────

interface OrbitingIcon {
  mesh: THREE.Sprite;
  baseX: number;
  baseY: number;
  baseZ: number;
  orbitRadius: number;
  speed: number;
  phase: number;
}

/** Emoji sprite with a colored circle background */
function createEmojiSprite(emoji: string, bgColor: string): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `${Math.floor(size * 0.55)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size / 2 + 3);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  return new THREE.Sprite(material);
}

/** Parking signpost: vertical pole + colored sign board */
function createParkingSignpost(parkingType: "free" | "paid" | "valet", s: number): THREE.Group {
  const group = new THREE.Group();

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.4 * s, 0.4 * s, 22 * s, 6);
  poleGeo.rotateX(Math.PI / 2);
  poleGeo.translate(0, 0, 11 * s);
  const poleMat = new THREE.MeshStandardMaterial({
    color: "#9ca3af", metalness: 0.8, roughness: 0.2, side: THREE.BackSide,
  });
  group.add(new THREE.Mesh(poleGeo, poleMat));

  // Sign canvas
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const colors = { free: "#22c55e", paid: "#3b82f6", valet: "#f59e0b" };
  const labels = { free: "P", paid: "P$", valet: "V" };

  ctx.fillStyle = colors[parkingType];
  ctx.beginPath();
  ctx.roundRect?.(4, 4, 56, 56, 8) ?? ctx.rect(4, 4, 56, 56);
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(labels[parkingType], 32, 32);

  const signTex = new THREE.CanvasTexture(canvas);
  const signGeo = new THREE.BoxGeometry(7 * s, 7 * s, 1.5 * s);
  signGeo.translate(0, 0, 24 * s);
  group.add(new THREE.Mesh(signGeo, new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide })));

  return group;
}

/** Semi-transparent Saturn-style ring around the building top for wheelchair accessibility */
function createWheelchairRing(buildingW: number): THREE.Mesh {
  const radius = buildingW * 1.1;
  const tube   = buildingW * 0.045;
  const geo = new THREE.TorusGeometry(radius, tube, 8, 48);
  // default torus is in XY plane → tilt 35° to look like Saturn rings
  geo.rotateX(Math.PI / 2);   // now vertical (YZ plane)
  geo.rotateZ(Math.PI / 5.5); // tilt ~33°

  const mat = new THREE.MeshStandardMaterial({
    color: "#00bfff",
    emissive: "#007fff",
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.60,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

// ── Custom layer export ────────────────────────────────────────────────────────

export function createBuildingCustomLayer(
  map: maplibregl.Map,
  restaurants: Restaurant[]
): maplibregl.CustomLayerInterface {
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.Camera;

  const refMerc = maplibregl.MercatorCoordinate.fromLngLat([REF_LNG, REF_LAT], 0);
  const s = refMerc.meterInMercatorCoordinateUnits() * 4;

  let buildingGroups: THREE.Group[] = [];
  let foodIconGroups: { outer: THREE.Group; baseZ: number }[] = [];
  let orbitingIcons: OrbitingIcon[] = [];
  let wheelchairRings: { mesh: THREE.Mesh; bx: number; by: number }[] = [];
  let parkingSignposts: THREE.Group[] = [];

  // Maps restaurant id → building top Z in Mercator units
  const buildingTopZMap = new Map<string, number>();

  // ── Icon size constants
  const ICON_SIZE   = 11 * s;  // sprite scale
  const ORBIT_R_BASE = 28 * s; // default orbit radius

  function rebuildOrbitingIcons() {
    orbitingIcons.forEach(({ mesh }) => scene.remove(mesh));
    wheelchairRings.forEach(({ mesh }) => scene.remove(mesh));
    orbitingIcons = [];
    wheelchairRings = [];

    restaurants.forEach((r, restaurantIndex) => {
      const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const bx = merc.x - refMerc.x;
      const by = merc.y - refMerc.y;
      const topZ = buildingTopZMap.get(r.id) ?? 0;

      let slotIndex = 0;

      const addIcon = (
        emoji: string,
        bgColor: string,
        speed: number,
        radiusMultiplier = 1,
      ) => {
        const sprite = createEmojiSprite(emoji, bgColor);
        sprite.scale.setScalar(ICON_SIZE);
        scene.add(sprite);
        orbitingIcons.push({
          mesh: sprite,
          baseX: bx,
          baseY: by,
          baseZ: topZ + (18 + slotIndex * 22) * s,
          orbitRadius: ORBIT_R_BASE * radiusMultiplier,
          speed,
          phase: (restaurantIndex * 2.3 + slotIndex * 1.7) % (Math.PI * 2),
        });
        slotIndex++;
      };

      // 🔥 Trending
      if (r.isTrending) addIcon("🔥", "rgba(220,80,0,0.85)", 1.4);

      // ♿ Wheelchair accessible
      if (r.isWheelchairAccessible) {
        addIcon("♿", "rgba(0,140,255,0.85)", 0.65, 1.15);

        // Saturn-style ring around building top
        const baseW = getBuildingBaseW(r, s);
        const ring  = createWheelchairRing(baseW);
        ring.position.set(bx, by, topZ);
        scene.add(ring);
        wheelchairRings.push({ mesh: ring, bx, by });
      }

      // 🎵 Live music
      if (r.hasLiveMusic) addIcon("🎵", "rgba(140,0,220,0.85)", 1.6, 0.9);

      // 🐕 Dogs allowed
      if (r.allowsDogs) addIcon("🐕", "rgba(60,180,80,0.85)", 1.0, 1.05);

      // 🍸 Cocktails
      if (r.servesCocktails) addIcon("🍸", "rgba(200,40,130,0.85)", 1.2, 0.95);
    });
  }

  function rebuildParkingSignposts() {
    parkingSignposts.forEach((g) => scene.remove(g));
    parkingSignposts = [];

    const OFFSET = 20 * s; // distance from building center

    restaurants.forEach((r) => {
      if (!r.parkingType) return;
      const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
      const bx = merc.x - refMerc.x;
      const by = merc.y - refMerc.y;

      const sign = createParkingSignpost(r.parkingType as "free" | "paid" | "valet", s);
      sign.position.set(bx + OFFSET, by + OFFSET, 0);
      scene.add(sign);
      parkingSignposts.push(sign);
    });
  }

  function rebuildBuildings(models: BuildingModels | null) {
    buildingGroups.forEach((g) => scene.remove(g));
    buildingGroups = [];
    buildingTopZMap.clear();

    for (const r of restaurants) {
      const g = createBuildingGroup(r, refMerc, s, models);

      // Phase 5: dim closed buildings
      if (r.isOpenNow === false) {
        g.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const dim = (mat: THREE.Material) => {
              if ((mat as THREE.MeshStandardMaterial).emissiveIntensity !== undefined) {
                (mat as THREE.MeshStandardMaterial).emissiveIntensity *= 0.3;
                (mat as THREE.MeshStandardMaterial).color.multiplyScalar(0.6);
              }
            };
            if (Array.isArray(mesh.material)) mesh.material.forEach(dim);
            else if (mesh.material) dim(mesh.material);
          }
        });
      }

      scene.add(g);
      buildingGroups.push(g);

      // Track building top Z for orbiting icons
      const box = new THREE.Box3().setFromObject(g);
      buildingTopZMap.set(r.id, box.max.z);
    }

    // Rebuild overlays after buildings
    rebuildOrbitingIcons();
    rebuildParkingSignposts();
  }

  function rebuildFoodIcons(food: FoodModels, buildings: BuildingModels | null) {
    foodIconGroups.forEach(({ outer }) => scene.remove(outer));
    foodIconGroups = [];

    const SIZE = 14 * s;
    const FLOAT_GAP = 6 * s;

    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      const template = food[r.category];
      if (!template) continue;

      const tier = getBuildingTier(r.reviewCount, r.rating);
      if (tier === "landmark" && buildings?.[`landmark_${r.category}` as LandmarkModelKey]) continue;

      const actualTopZ = new THREE.Box3().setFromObject(buildingGroups[i]).max.z;
      const icon = placeGlbModel(template, SIZE, SIZE);
      const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);

      const outer = new THREE.Group();
      outer.position.set(merc.x - refMerc.x, merc.y - refMerc.y, actualTopZ + FLOAT_GAP);
      outer.add(icon);
      scene.add(outer);
      foodIconGroups.push({ outer, baseZ: actualTopZ + FLOAT_GAP });
    }
  }

  return {
    id: "3d-buildings",
    type: "custom",
    renderingMode: "3d",

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      scene = new THREE.Scene();

      scene.add(new THREE.AmbientLight(0xffffff, 3.0));

      const dir = new THREE.DirectionalLight(0xffeedd, 2.5);
      dir.position.set(0.5, -0.3, 1.0);
      scene.add(dir);

      const dir2 = new THREE.DirectionalLight(0x8888ff, 1.0);
      dir2.position.set(-0.3, 0.5, 0.8);
      scene.add(dir2);

      // First pass: procedural (instant) — also builds orbiting icons
      rebuildBuildings(null);

      // Point lights above trending restaurants
      for (const r of restaurants.filter((r) => r.isTrending)) {
        const merc  = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
        const hMerc = Math.max(30, r.reviewCount * 0.6) * s;
        const light = new THREE.PointLight(0xffaa00, 0.00002, s * 300);
        light.position.set(merc.x - refMerc.x, merc.y - refMerc.y, hMerc + s * 20);
        scene.add(light);
      }

      camera = new THREE.Camera();
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
      pmrem.dispose();

      // Second pass: GLB models when ready
      const draco = new DRACOLoader();
      draco.setDecoderPath("/draco/");
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      Promise.all([loadBuildingModels(loader), loadFoodModels(loader)]).then(
        ([buildings, food]) => {
          if (Object.keys(buildings).length > 0) {
            rebuildBuildings(buildings); // also rebuilds orbiting icons
          }
          if (Object.keys(food).length > 0) {
            rebuildFoodIcons(food, buildings);
          }
          map.triggerRepaint();
        },
      );
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(_gl: WebGLRenderingContext, args: any) {
      const t = Date.now() / 1000;

      // Bob food icons
      foodIconGroups.forEach(({ outer, baseZ }, i) => {
        outer.position.z = baseZ + Math.sin(t * 1.5 + i * 0.8) * 5 * s;
      });

      // Orbit emoji icons
      orbitingIcons.forEach((icon) => {
        const angle = t * icon.speed + icon.phase;
        icon.mesh.position.x = icon.baseX + Math.cos(angle) * icon.orbitRadius;
        icon.mesh.position.y = icon.baseY + Math.sin(angle) * icon.orbitRadius;
        // Slight vertical bob
        icon.mesh.position.z = icon.baseZ + Math.sin(t * 0.8 + icon.phase) * 4 * s;
      });

      // Slowly spin wheelchair rings
      wheelchairRings.forEach(({ mesh }) => {
        mesh.rotation.z += 0.004;
      });

      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(refMerc.x, refMerc.y, refMerc.z);

      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };
}
