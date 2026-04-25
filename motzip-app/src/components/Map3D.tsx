"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { restaurants as staticRestaurants } from "@/data/restaurants";
import { Restaurant } from "@/types/restaurant";
import { createBuildingCustomLayer } from "./BuildingLayer";
import RestaurantPanel from "./RestaurantPanel";
import Fireworks from "./Fireworks";
import VoiceSearch from "./VoiceSearch";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

type IconFilterKey =
  | "trending" | "wheelchair"
  | "parking_free" | "parking_paid" | "parking_valet"
  | "live_music" | "dogs" | "cocktails";

const ICON_FILTER_DEFS: { key: IconFilterKey; label: string; match: (r: Restaurant) => boolean }[] = [
  { key: "trending",      label: "Trending",     match: (r) => r.isTrending },
  { key: "wheelchair",    label: "Wheelchair",   match: (r) => !!r.isWheelchairAccessible },
  { key: "parking_free",  label: "Free Parking", match: (r) => r.parkingType === "free" },
  { key: "parking_paid",  label: "Paid Parking", match: (r) => r.parkingType === "paid" },
  { key: "parking_valet", label: "Valet",        match: (r) => r.parkingType === "valet" },
  { key: "live_music",    label: "Live Music",   match: (r) => !!r.hasLiveMusic },
  { key: "dogs",          label: "Dogs OK",      match: (r) => !!r.allowsDogs },
  { key: "cocktails",     label: "Cocktails",    match: (r) => !!r.servesCocktails },
];

function buildGeoJSON(restaurants: Restaurant[]) {
  return {
    type: "FeatureCollection" as const,
    features: restaurants.map((r) => ({
      type: "Feature" as const,
      properties: {
        id: r.id,
        name: r.name,
        height: Math.max(30, r.reviewCount * 0.6),
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [buildSquare(r.lng, r.lat, 0.00022)],
      },
    })),
  };
}

function buildSquare(lng: number, lat: number, size: number) {
  const half = size / 2;
  return [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half],
  ];
}

const DEFAULT_CENTER: [number, number] = [-71.058, 42.355];

export default function Map3D() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const setFilterRef = useRef<((ids: Set<string> | null) => void) | null>(null);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "live" | "static">("loading");
  const [voiceResults, setVoiceResults] = useState<Restaurant[] | null>(null);
  const [iconFilters, setIconFilters] = useState<Set<IconFilterKey>>(new Set());
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number }>(
    { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] }
  );

  // Track user GPS position for voice search
  useEffect(() => {
    if (!navigator.geolocation) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) => setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, []);

  // Fetch restaurants from server, fall back to static data
  useEffect(() => {
    const controller = new AbortController();
    const fallbackTimer = setTimeout(() => {
      if (restaurants.length === 0) {
        setRestaurants(staticRestaurants);
        setDataSource("static");
      }
    }, 5000);

    fetch(`${SERVER_URL}/api/restaurants`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Restaurant[]) => {
        clearTimeout(fallbackTimer);
        if (data && data.length > 0) {
          setRestaurants(data);
          setDataSource("live");
        } else {
          setRestaurants(staticRestaurants);
          setDataSource("static");
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        clearTimeout(fallbackTimer);
        setRestaurants(staticRestaurants);
        setDataSource("static");
      });

    return () => {
      controller.abort();
      clearTimeout(fallbackTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply combined voice + icon filters to 3D buildings (intersection)
  useEffect(() => {
    if (!setFilterRef.current) return;
    let ids: Set<string> | null = voiceResults
      ? new Set(voiceResults.map((r) => r.id))
      : null;
    if (iconFilters.size > 0) {
      const matchers = ICON_FILTER_DEFS.filter((d) => iconFilters.has(d.key)).map((d) => d.match);
      const matchedIds = new Set(
        restaurants.filter((r) => matchers.every((m) => m(r))).map((r) => r.id)
      );
      ids = ids === null ? matchedIds : new Set([...ids].filter((id) => matchedIds.has(id)));
    }
    setFilterRef.current(ids);
  }, [voiceResults, iconFilters, restaurants]);

  const toggleIconFilter = (k: IconFilterKey) => {
    setIconFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const trendingRestaurants = restaurants.filter((r) => r.isTrending);

  useEffect(() => {
    if (!mapContainer.current || restaurants.length === 0) return;
    // If map already initialized, just update the GeoJSON source
    if (mapRef.current) {
      const map = mapRef.current;
      const src = map.getSource("restaurants-hit") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(buildGeoJSON(restaurants));
      }
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: DEFAULT_CENTER,
      zoom: 14.5,
      pitch: 50,
      bearing: 0,
      maxPitch: 60,
      minZoom: 12,
    } as maplibregl.MapOptions);

    // Left-drag = pan only, right-drag = rotate
    map.dragRotate.disable();
    (map.dragRotate as unknown as { enable(opts: { button: string }): void }).enable({ button: "right" });

    mapRef.current = map;
    setMapInstance(map);

    map.on("load", () => {
      // ── "Pastel Sunset" theme — storybook palette, all colors lifted toward cream ──
      // Terrain: very soft pastels with warm undertone — parks now properly green
      const muteFills: Record<string, string> = {
        background:           "#fbf2dd",  // pastel cream
        park:                 "#9ed6a0",  // vivid pastel green
        landcover_grass:      "#b8e0b6",  // lighter green
        landcover_wood:       "#7ec98a",  // deeper forest pastel
        water:                "#c4dbd8",  // pastel mint
        landuse_residential:  "#f3e7d0",  // soft peach-cream
        landuse_commercial:   "#f3e6cf",
        building:             "#ecd8be",  // pastel beige
      };
      for (const [id, color] of Object.entries(muteFills)) {
        const lyr = map.getLayer(id);
        if (!lyr) continue;
        const prop = lyr.type === "background" ? "background-color" : "fill-color";
        try {
          map.setPaintProperty(id, prop, color);
          if (lyr.type === "fill") map.setPaintProperty(id, "fill-opacity", 0.9);
        } catch {}
      }

      // Roads/features: pastel rainbow within the sunset family
      const vividLines: Record<string, string> = {
        highway_motorway_inner:    "#f08a7a",  // pastel peach-coral
        highway_motorway_casing:   "#cf7068",  // dusty coral
        highway_motorway_subtle:   "#fab9a8",  // very soft coral
        highway_major_inner:       "#f8c878",  // butter amber
        highway_major_casing:      "#cd9658",  // toasted amber
        highway_major_subtle:      "#fde2ad",  // soft butter
        highway_minor:             "#eea4b8",  // soft pink
        highway_path:              "#daa088",  // soft terracotta
        railway:                   "#84c8c2",  // pastel teal
        railway_transit:           "#c5a0c5",  // lavender
        railway_service:           "#a8d8d2",  // light pastel teal
        waterway:                  "#84c8c2",  // matches railway pastel teal
      };
      for (const [id, color] of Object.entries(vividLines)) {
        if (!map.getLayer(id)) continue;
        try {
          map.setPaintProperty(id, "line-color", color);
        } catch {}
      }

      // Three.js custom layer for 3D buildings with textures
      const { layer: buildingLayer, setFilter } = createBuildingCustomLayer(map, restaurants);
      setFilterRef.current = setFilter;
      map.addLayer(buildingLayer);

      // Invisible fill-extrusion for click hit-testing
      const geojson = buildGeoJSON(restaurants);
      map.addSource("restaurants-hit", { type: "geojson", data: geojson });
      map.addLayer({
        id: "restaurant-hit",
        type: "fill-extrusion",
        source: "restaurants-hit",
        paint: {
          "fill-extrusion-color": "#000000",
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0,
        },
      });

      // Click handler
      map.on("click", "restaurant-hit", (e) => {
        if (!e.features || e.features.length === 0) return;
        const id = e.features[0].properties?.id;
        const r = restaurants.find((r) => r.id === id);
        if (r) {
          setSelected(r);
          map.flyTo({ center: [r.lng, r.lat], zoom: 16, pitch: 55, duration: 800 });
        }
      });

      map.on("mouseenter", "restaurant-hit", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "restaurant-hit", () => {
        map.getCanvas().style.cursor = "";
      });

    });

    // Navigation (zoom only, no compass)
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Geolocation button
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }),
      "top-right"
    );

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [restaurants]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainer}
        className="w-full h-full"
      />

      {/* Pastel ambient corners — barely there, just a hint of sunset gradient */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 100% 0%, rgba(255, 224, 178, 0.28) 0%, transparent 60%), radial-gradient(ellipse 70% 60% at 0% 0%, rgba(255, 196, 211, 0.22) 0%, transparent 60%), radial-gradient(ellipse 70% 60% at 0% 100%, rgba(178, 226, 222, 0.22) 0%, transparent 60%), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(213, 188, 217, 0.20) 0%, transparent 60%)",
        }}
      />
      {/* Soft cream horizon for 3D pitch depth */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(255, 226, 200, 0.32) 0%, rgba(255, 226, 200, 0.10) 12%, transparent 26%)",
        }}
      />
      {/* Whisper-soft pastel vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background:
            "radial-gradient(ellipse 115% 100% at 50% 50%, transparent 70%, rgba(180, 130, 110, 0.16) 100%)",
        }}
      />
      {/* Bottom city-glow accent */}
      <div
        className="absolute inset-x-0 bottom-0 h-40 pointer-events-none z-10"
        style={{
          background:
            "linear-gradient(0deg, rgba(56, 189, 248, 0.08) 0%, transparent 100%)",
        }}
      />

      <Fireworks
        map={mapInstance}
        lngLats={trendingRestaurants.map((r) => ({ lng: r.lng, lat: r.lat }))}
      />

      {/* Data source badge */}
      {dataSource !== "loading" && (
        <div className="absolute top-3 left-3 z-20">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border backdrop-blur-xl shadow-lg ${
            dataSource === "live"
              ? "bg-emerald-950/70 border-emerald-500/20 text-emerald-300"
              : "bg-gray-950/70 border-white/[0.06] text-gray-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dataSource === "live" ? "bg-emerald-400 animate-pulse" : "bg-gray-500"}`} />
            {dataSource === "live" ? "Google Places" : "Demo data"}
          </div>
        </div>
      )}

      {/* Bottom-left: spot count + legend */}
      <div className="absolute bottom-4 left-3 z-20 flex flex-col gap-2">
        {/* Spot counter pill */}
        <div className="flex items-center gap-2 bg-gray-950/70 backdrop-blur-xl rounded-xl px-3 py-2 border border-white/[0.06] shadow-xl shadow-black/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-xs text-gray-200 font-semibold">{restaurants.length}</span>
          <span className="text-xs text-gray-500">spots</span>
        </div>

        {/* Legend */}
        <div className="bg-gray-950/70 backdrop-blur-xl rounded-2xl p-3 border border-white/[0.06] text-[10px] text-gray-400 space-y-1.5 shadow-xl shadow-black/30">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 font-bold pb-0.5">Building</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-5 rounded-sm bg-gradient-to-t from-amber-700 to-amber-300" />
            <span>Height = Reviews</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-300 to-amber-500" />
            <span>Gold = Top Rated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-rose-400 to-red-600" />
            <span>Red = Lower Rated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-700/60 border border-gray-500/40" />
            <span>Dim = Currently Closed</span>
          </div>
          <div className="flex items-center justify-between pt-0.5 pb-0.5">
            <p className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Filter by feature</p>
            {iconFilters.size > 0 && (
              <button
                onClick={() => setIconFilters(new Set())}
                className="text-[9px] uppercase tracking-widest text-violet-400 hover:text-violet-200 font-bold"
              >
                Clear
              </button>
            )}
          </div>
          {ICON_FILTER_DEFS.map(({ key, label }) => {
            const active = iconFilters.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleIconFilter(key)}
                className={`flex items-center gap-2 w-full px-1.5 -mx-1.5 py-0.5 rounded transition ${
                  active
                    ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                }`}
              >
                <img src={`/icons/${key}.svg`} alt="" className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <RestaurantPanel restaurant={selected} onClose={() => setSelected(null)} />
      )}

      {/* Voice filter active badge */}
      {voiceResults !== null && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-950/80 border border-violet-500/20 text-violet-300 text-[11px] font-semibold backdrop-blur-xl shadow-lg">
            <span className="text-violet-400">&#127908;</span>
            음성 필터 적용됨 — {voiceResults.length}곳
          </div>
        </div>
      )}

      <VoiceSearch
        userLat={userPosition.lat}
        userLng={userPosition.lng}
        onResults={(filtered) => setVoiceResults(filtered)}
        onClear={() => setVoiceResults(null)}
      />
    </div>
  );
}
