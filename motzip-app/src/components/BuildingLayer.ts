import * as THREE from "three";
import maplibregl from "maplibre-gl";
import { restaurants } from "@/data/restaurants";
import { Restaurant } from "@/types/restaurant";

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

/**
 * Coordinate system in this layer (matches MapLibre Mercator space directly):
 *   X = Mercator X (east-west)
 *   Y = Mercator Y (north-south, south is +Y)
 *   Z = altitude (up)
 *
 * All positions are in Mercator units relative to refMerc.
 * Geometry heights extend along Z.
 */

// Building tier based on review count AND rating
function getBuildingTier(reviewCount: number, rating: number): "landmark" | "major" | "mid" | "regular" {
  const score = reviewCount * rating; // composite score
  if (score >= 2000 && rating >= 4.5) return "landmark";
  if (score >= 1500 && rating >= 4.2) return "major";
  if (score >= 700) return "mid";
  return "regular";
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
  // CylinderGeometry is Y-up in Three.js, rotate to Z-up
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, zBase + h / 2);

  // Cylinder faces: side, top cap, bottom cap
  const mesh = new THREE.Mesh(geo, [mat, topMat, bottomMat]);
  group.add(mesh);
  return zBase + h;
}

function createBuildingMesh(
  r: Restaurant,
  scene: THREE.Scene,
  refMerc: maplibregl.MercatorCoordinate,
  s: number
) {
  const tier = getBuildingTier(r.reviewCount, r.rating);
  const group = new THREE.Group();

  const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
  group.position.set(merc.x - refMerc.x, merc.y - refMerc.y, 0);

  const tex = createWindowTexture(r.rating, r.isTrending);
  const tex2 = createWindowTexture(r.rating + 0.3, r.isTrending, 48, 96);

  if (tier === "landmark") {
    // === LANDMARK: Burj Khalifa-style stepped tower ===
    const totalH = r.reviewCount * 1.2 * s;
    const baseW = 35 * s;

    // Wide base podium
    const wall0 = makeWallMat(tex, r.rating);
    const top0 = makeTopMat(r.rating);
    let z = 0;
    z = addBoxSection(group, baseW, baseW, totalH * 0.15, z, wall0, top0);

    // Main tower section (3 stepped tiers)
    const wall1 = makeWallMat(tex, r.rating, 0.2);
    const top1 = makeTopMat(r.rating, true);
    z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.30, z, wall1, top1);

    // Second tier, rotated 45deg for visual interest
    const wall2 = makeWallMat(tex2, r.rating, 0.4);
    const tier2W = baseW * 0.5;
    const geo2 = new THREE.BoxGeometry(tier2W, tier2W, totalH * 0.25);
    geo2.translate(0, 0, z + totalH * 0.25 / 2);
    const mesh2 = new THREE.Mesh(geo2, [wall2, wall2, wall2, wall2, makeTopMat(r.rating, true), bottomMat]);
    mesh2.rotation.z = Math.PI / 4;
    group.add(mesh2);
    z += totalH * 0.25;

    // Tapered spire
    const spireMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#FFD700"),
      emissive: new THREE.Color(1.0, 0.8, 0.2),
      emissiveIntensity: 0.6,
      metalness: 0.95,
      roughness: 0.05,
      side: THREE.BackSide,
    });
    z = addCylinderSection(group, baseW * 0.15, baseW * 0.02, totalH * 0.30, z, spireMat, spireMat, 6);

  } else if (tier === "major") {
    // === MAJOR: 3-tier stepped tower ===
    const totalH = r.reviewCount * 0.9 * s;
    const baseW = 26 * s;

    const wall0 = makeWallMat(tex, r.rating);
    const top0 = makeTopMat(r.rating);
    let z = 0;

    // Base
    z = addBoxSection(group, baseW, baseW, totalH * 0.4, z, wall0, top0);
    // Middle
    const wall1 = makeWallMat(tex2, r.rating, 0.15);
    z = addBoxSection(group, baseW * 0.7, baseW * 0.7, totalH * 0.35, z, wall1, makeTopMat(r.rating));
    // Top
    const wall2 = makeWallMat(tex, r.rating, 0.3);
    z = addBoxSection(group, baseW * 0.45, baseW * 0.45, totalH * 0.25, z, wall2, makeTopMat(r.rating, true));

    // Antenna
    const antMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#cccccc"),
      metalness: 0.9, roughness: 0.1, side: THREE.BackSide,
    });
    addCylinderSection(group, baseW * 0.03, baseW * 0.01, totalH * 0.12, z, antMat, antMat, 4);

  } else if (tier === "mid") {
    // === MID: 2-tier building ===
    const totalH = r.reviewCount * 0.7 * s;
    const baseW = 18 * s;

    const wall0 = makeWallMat(tex, r.rating);
    let z = 0;

    z = addBoxSection(group, baseW, baseW, totalH * 0.55, z, wall0, makeTopMat(r.rating));
    const wall1 = makeWallMat(tex2, r.rating, 0.1);
    addBoxSection(group, baseW * 0.65, baseW * 0.65, totalH * 0.45, z, wall1, makeTopMat(r.rating));

  } else {
    // === REGULAR: simple box ===
    const hMeters = Math.max(30, r.reviewCount * 0.6);
    const baseMeters = 12 + Math.min(r.reviewCount * 0.01, 8);
    const w = baseMeters * s;
    const h = hMeters * s;

    const wall = makeWallMat(tex, r.rating);
    addBoxSection(group, w, w, h, 0, wall, makeTopMat(r.rating));
  }

  scene.add(group);
}

export function createBuildingCustomLayer(
  map: maplibregl.Map
): maplibregl.CustomLayerInterface {
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.Camera;

  const refMerc = maplibregl.MercatorCoordinate.fromLngLat([REF_LNG, REF_LAT], 0);
  const s = refMerc.meterInMercatorCoordinateUnits();

  return {
    id: "3d-buildings",
    type: "custom",
    renderingMode: "3d",

    onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext) {
      scene = new THREE.Scene();

      // Lighting — Z is up
      scene.add(new THREE.AmbientLight(0x404060, 2.0));

      const dir = new THREE.DirectionalLight(0xffeedd, 1.5);
      dir.position.set(0.5, -0.3, 1.0); // from above-southeast
      scene.add(dir);

      const dir2 = new THREE.DirectionalLight(0x8888ff, 0.5);
      dir2.position.set(-0.3, 0.5, 0.8); // from above-northwest
      scene.add(dir2);

      // Build all restaurants
      for (const r of restaurants) {
        createBuildingMesh(r, scene, refMerc, s);
      }

      // Point lights above trending restaurants
      for (const r of restaurants.filter((r) => r.isTrending)) {
        const merc = maplibregl.MercatorCoordinate.fromLngLat([r.lng, r.lat], 0);
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
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(_gl: WebGLRenderingContext, args: any) {
      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(refMerc.x, refMerc.y, refMerc.z);

      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };
}
