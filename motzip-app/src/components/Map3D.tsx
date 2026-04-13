"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { restaurants } from "@/data/restaurants";
import { Restaurant, categoryEmoji } from "@/types/restaurant";
import { createBuildingCustomLayer } from "./BuildingLayer";
import RestaurantPanel from "./RestaurantPanel";
import Fireworks from "./Fireworks";

function buildGeoJSON() {
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
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [trendingScreenPositions, setTrendingScreenPositions] = useState<
    { x: number; y: number }[]
  >([]);

  const trendingRestaurants = restaurants.filter((r) => r.isTrending);

  useEffect(() => {
    if (!mapContainer.current) return;

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
      const buildingLayer = createBuildingCustomLayer(map);
      map.addLayer(buildingLayer);

      // Invisible fill-extrusion for click hit-testing
      const geojson = buildGeoJSON();
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

      // Calculate pixel offset for building top based on camera
      const calcTopOffset = (heightMeters: number): number => {
        const pitch = map.getPitch() * Math.PI / 180;
        const zoom = map.getZoom();
        // Meters-to-pixels at current zoom (approximate at Boston latitude)
        const pixelsPerMeter = Math.pow(2, zoom) / (156543.03392 * Math.cos(42.355 * Math.PI / 180));
        return -heightMeters * pixelsPerMeter * Math.sin(pitch);
      };

      // Category emoji markers — only show at high zoom
      type MarkerEntry = { marker: maplibregl.Marker; height: number };
      const markerEntries: MarkerEntry[] = [];

      const rebuildMarkers = () => {
        const zoom = map.getZoom();
        const bounds = map.getBounds();
        const showMarkers = zoom >= 14;

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        markerEntries.length = 0;

        if (!showMarkers) return;

        const visible = restaurants.filter(
          (r) =>
            r.lat >= bounds.getSouth() &&
            r.lat <= bounds.getNorth() &&
            r.lng >= bounds.getWest() &&
            r.lng <= bounds.getEast()
        );

        for (const r of visible) {
          const el = document.createElement("div");
          el.className = "category-marker";
          const span = document.createElement("span");
          span.textContent = categoryEmoji[r.category];
          el.appendChild(span);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            setSelected(r);
            map.flyTo({ center: [r.lng, r.lat], zoom: 16, pitch: 55, duration: 800 });
          });

          const buildingHeight = Math.max(30, r.reviewCount * 0.6);
          const offsetY = calcTopOffset(buildingHeight);
          const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([r.lng, r.lat])
            .setOffset([0, offsetY])
            .addTo(map);

          markersRef.current.push(marker);
          markerEntries.push({ marker, height: buildingHeight });
        }
      };

      // Re-calculate offsets on camera move (zoom/pitch change building apparent height)
      const updateMarkerOffsets = () => {
        for (const entry of markerEntries) {
          entry.marker.setOffset([0, calcTopOffset(entry.height)]);
        }
      };

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

      rebuildMarkers();
      updateFireworks();

      map.on("moveend", () => {
        rebuildMarkers();
        updateFireworks();
      });
      map.on("zoomend", rebuildMarkers);
      map.on("move", () => {
        updateMarkerOffsets();
        updateFireworks();
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
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      <Fireworks positions={trendingScreenPositions} />

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
