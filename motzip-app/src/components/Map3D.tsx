"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { restaurants as staticRestaurants } from "@/data/restaurants";
import { Restaurant } from "@/types/restaurant";
import { createBuildingCustomLayer } from "./BuildingLayer";
import RestaurantPanel from "./RestaurantPanel";
import Fireworks from "./Fireworks";

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
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [trendingScreenPositions, setTrendingScreenPositions] = useState<
    { x: number; y: number }[]
  >([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "live" | "static">("loading");

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
      const buildingLayer = createBuildingCustomLayer(map, restaurants);
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
        <div className="bg-gray-950/70 backdrop-blur-xl rounded-2xl p-3 border border-white/[0.06] text-[10px] text-gray-400 space-y-2 shadow-xl shadow-black/30">
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
            <span className="text-sm leading-none">&#x2728;</span>
            <span>Sparks = Trending</span>
          </div>
        </div>
      </div>

      {selected && (
        <RestaurantPanel restaurant={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
