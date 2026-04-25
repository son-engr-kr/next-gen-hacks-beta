"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { restaurants as staticRestaurants } from "@/data/restaurants";
import { Restaurant } from "@/types/restaurant";
import { createBuildingCustomLayer } from "./BuildingLayer";
import RestaurantPanel from "./RestaurantPanel";
import BatchCallPanel from "./BatchCallPanel";
import Fireworks from "./Fireworks";
import VoiceSearch from "./VoiceSearch";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

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
  const [trendingScreenPositions, setTrendingScreenPositions] = useState<
    { x: number; y: number }[]
  >([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "live" | "static">("loading");
  const [voiceResults, setVoiceResults] = useState<Restaurant[] | null>(null);
  const [selectedForCall, setSelectedForCall] = useState<Set<string>>(new Set());
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number }>(
    { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] }
  );

  // Refs let the once-registered map click handler read the latest values
  // without having to re-bind on every state change.
  const voiceResultsRef = useRef<Restaurant[] | null>(null);
  const selectedForCallRef = useRef<Set<string>>(new Set());
  useEffect(() => { voiceResultsRef.current = voiceResults; }, [voiceResults]);
  useEffect(() => { selectedForCallRef.current = selectedForCall; }, [selectedForCall]);

  // Reset selection whenever a fresh search returns
  useEffect(() => {
    setSelectedForCall(new Set());
  }, [voiceResults]);

  const toggleCallSelection = (id: string) => {
    setSelectedForCall((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  // Apply voice filter to 3D buildings
  useEffect(() => {
    if (!setFilterRef.current) return;
    if (voiceResults === null) {
      setFilterRef.current(null);
    } else {
      setFilterRef.current(new Set(voiceResults.map((r) => r.id)));
    }
  }, [voiceResults]);

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
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap &copy; CARTO",
          },
        },
        layers: [
          {
            id: "carto-tiles",
            type: "raster",
            source: "carto",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
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

    map.on("load", () => {
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

      // Click handler. When the BatchCallPanel is up (voiceResults active and
      // the clicked building is one of the matches), toggle its selection
      // instead of opening the single-restaurant panel.
      map.on("click", "restaurant-hit", (e) => {
        if (!e.features || e.features.length === 0) return;
        const id = e.features[0].properties?.id;
        const r = restaurants.find((r) => r.id === id);
        if (!r) return;

        const vr = voiceResultsRef.current;
        const matchInBatch = vr?.find((x) => x.id === r.id);
        if (matchInBatch) {
          // Only callable restaurants can be batch-selected; ignore the rest.
          if (matchInBatch.phone) {
            toggleCallSelection(r.id);
          }
          map.flyTo({ center: [r.lng, r.lat], zoom: 16, pitch: 55, duration: 800 });
          return;
        }

        setSelected(r);
        map.flyTo({ center: [r.lng, r.lat], zoom: 16, pitch: 55, duration: 800 });
      });

      map.on("mouseenter", "restaurant-hit", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "restaurant-hit", () => {
        map.getCanvas().style.cursor = "";
      });

      // Update trending firework positions
      const updateFireworks = () => {
        const canvas = map.getCanvas();
        const positions = trendingRestaurants
          .map((r) => {
            const pt = map.project([r.lng, r.lat]);
            return { x: pt.x, y: pt.y };
          })
          .filter(
            (p) =>
              p.x > 0 && p.y > 0 && p.x < canvas.clientWidth && p.y < canvas.clientHeight
          );
        setTrendingScreenPositions(positions);
      };

      updateFireworks();

      map.on("moveend", updateFireworks);
      map.on("move", updateFireworks);
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
      <div ref={mapContainer} className="w-full h-full" />
      <Fireworks positions={trendingScreenPositions} />

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
          <p className="text-[9px] uppercase tracking-widest text-gray-600 font-bold pt-0.5 pb-0.5">Gems (beside building)</p>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-orange-500" /><span>Trending</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-sky-400" /><span>Wheelchair</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-emerald-400" /><span>Free Parking</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-blue-400" /><span>Paid Parking</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-amber-400" /><span>Valet</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-purple-400" /><span>Live Music</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-lime-400" /><span>Dogs OK</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rotate-45 bg-pink-400" /><span>Cocktails</span></div>
        </div>
      </div>

      {voiceResults && voiceResults.length > 0 ? (
        <BatchCallPanel
          restaurants={voiceResults}
          selectedIds={selectedForCall}
          onToggleSelection={toggleCallSelection}
          onClose={() => setVoiceResults(null)}
        />
      ) : selected ? (
        <RestaurantPanel restaurant={selected} onClose={() => setSelected(null)} />
      ) : null}

      {/* Voice filter active badge */}
      {voiceResults !== null && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-950/80 border border-violet-500/20 text-violet-300 text-[11px] font-semibold backdrop-blur-xl shadow-lg">
            <span className="text-violet-400">&#127908;</span>
            Voice filter active — {voiceResults.length} places
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
