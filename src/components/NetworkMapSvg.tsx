import React, { useMemo, useState } from 'react';
import type { Airport, AirportClosure, FlightSimulationResult } from '../engine/types';

interface NetworkMapSvgProps {
  airports: Airport[];
  flights: FlightSimulationResult[];
  closure: AirportClosure | null;
  selectedAirportId: string;
  onSelectAirport: (airportId: string) => void;
  titleSuffix?: string;
}

// India geographic bounds tailored to the 16 airports (lat 8.48..30.67, lng 72.63..91.59)
const MIN_LAT = 6.8;
const MAX_LAT = 32.8;
const MIN_LNG = 69.5;
const MAX_LNG = 94.2;

const SVG_W = 820;
const SVG_H = 580;
const PAD_X = 56;
const PAD_Y = 44;

function project(lat: number, lng: number): { x: number; y: number } {
  const x = PAD_X + ((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * (SVG_W - PAD_X * 2);
  const y = PAD_Y + ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * (SVG_H - PAD_Y * 2);
  return { x, y };
}

// Simplified Indian landmass reference contour (lon, lat) for spatial orientation
const INDIA_OUTLINE: Array<[number, number]> = [
  [74.2, 32.5], [77.5, 32.3], [79.0, 31.1], [80.8, 29.5], [82.0, 27.9],
  [84.5, 27.3], [87.5, 26.9], [89.8, 26.8], [92.8, 27.2], [93.6, 25.4],
  [92.0, 24.1], [89.6, 22.0], [88.2, 21.6], [86.8, 20.6], [85.2, 19.3],
  [82.8, 17.6], [80.3, 15.8], [80.3, 13.0], [79.8, 10.3], [77.5, 8.1],
  [76.2, 9.8], [74.9, 12.8], [73.7, 15.4], [72.8, 19.0], [72.6, 21.5],
  [70.3, 22.4], [70.8, 23.8], [72.2, 24.6], [70.9, 26.9], [73.4, 29.4],
  [74.2, 32.5],
];

type RouteSeverity = 'ON_TIME' | 'DELAYED' | 'CANCELLED';

interface AggregatedRoute {
  key: string;
  origin: string;
  destination: string;
  severity: RouteSeverity;
  flightCount: number;
  delayedCount: number;
  cancelledCount: number;
  maxDelay: number;
  flightIds: string[];
}

export const NetworkMapSvg: React.FC<NetworkMapSvgProps> = ({
  airports,
  flights,
  closure,
  selectedAirportId,
  onSelectAirport,
  titleSuffix,
}) => {
  const [hoveredAirportId, setHoveredAirportId] = useState<string | null>(null);
  const [hoveredRouteKey, setHoveredRouteKey] = useState<string | null>(null);

  const airportMap = useMemo(() => {
    const map = new Map<string, Airport & { x: number; y: number }>();
    for (const ap of airports) {
      const pos = project(ap.lat, ap.lng);
      map.set(ap.id, { ...ap, ...pos });
    }
    return map;
  }, [airports]);

  const outlinePath = useMemo(() => {
    return (
      INDIA_OUTLINE.map(([lng, lat], i) => {
        const { x, y } = project(lat, lng);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z'
    );
  }, []);

  const routes = useMemo(() => {
    const map = new Map<string, AggregatedRoute>();
    for (const f of flights) {
      // Undirected pair key so bidirectional corridor renders cleanly without duplicate overlapping lines,
      // while preserving worst severity across either direction
      const pair = [f.origin, f.destination].sort();
      const key = `${pair[0]}-${pair[1]}`;
      const existing = map.get(key) ?? {
        key,
        origin: pair[0],
        destination: pair[1],
        severity: 'ON_TIME' as RouteSeverity,
        flightCount: 0,
        delayedCount: 0,
        cancelledCount: 0,
        maxDelay: 0,
        flightIds: [],
      };
      existing.flightCount++;
      existing.flightIds.push(f.flightId);
      if (f.status === 'CANCELLED') {
        existing.cancelledCount++;
        existing.severity = 'CANCELLED';
      } else if (f.status === 'DELAYED') {
        existing.delayedCount++;
        if (f.delayMinutes > existing.maxDelay) existing.maxDelay = f.delayMinutes;
        if (existing.severity !== 'CANCELLED') existing.severity = 'DELAYED';
      }
      map.set(key, existing);
    }

    // Sort so normal routes draw first, delayed next, cancelled on top
    const order: Record<RouteSeverity, number> = { ON_TIME: 0, DELAYED: 1, CANCELLED: 2 };
    return Array.from(map.values()).sort((a, b) => order[a.severity] - order[b.severity]);
  }, [flights]);

  const airportStats = useMemo(() => {
    const stats = new Map<
      string,
      { depTotal: number; arrTotal: number; delayed: number; cancelled: number }
    >();
    for (const ap of airports) {
      stats.set(ap.id, { depTotal: 0, arrTotal: 0, delayed: 0, cancelled: 0 });
    }
    for (const f of flights) {
      const o = stats.get(f.origin);
      const d = stats.get(f.destination);
      if (o) {
        o.depTotal++;
        if (f.status === 'DELAYED') o.delayed++;
        if (f.status === 'CANCELLED') o.cancelled++;
      }
      if (d) {
        d.arrTotal++;
        if (f.status === 'DELAYED') d.delayed++;
        if (f.status === 'CANCELLED') d.cancelled++;
      }
    }
    return stats;
  }, [airports, flights]);

  const inspectedAirportId = hoveredAirportId ?? selectedAirportId;
  const inspectedAirport = airportMap.get(inspectedAirportId);
  const inspectedStats = inspectedAirportId ? airportStats.get(inspectedAirportId) : undefined;
  const inspectedRoute = hoveredRouteKey
    ? routes.find((r) => r.key === hoveredRouteKey)
    : undefined;

  return (
    <div className="flex flex-col bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#DAD8CE]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[#252923] tracking-tight">
              Flight Network Topology
            </h2>
            {titleSuffix && (
              <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-[#9B4A27] font-semibold">
                · {titleSuffix}
              </span>
            )}
          </div>
          <p className="text-xs text-[#5F6259]">
            16 airports plotted on geographic graticule · Select any station to target closure
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3.5 text-[11px] font-medium text-[#5A5D54]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-[1.5px] bg-[#76786D] inline-block" aria-hidden="true" />
            Normal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-[2px] bg-[#D69A32] inline-block" aria-hidden="true" />
            Delayed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-4 h-0 border-t-2 border-dashed border-[#B84239] inline-block"
              aria-hidden="true"
            />
            Disrupted / Cancelled
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full border border-[#B84239] bg-[#B84239]/20 inline-block"
              aria-hidden="true"
            />
            Closed Hub
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[#C76B43] inline-block"
              aria-hidden="true"
            />
            Target
          </span>
        </div>
      </div>

      <div
        className="relative bg-[#EAE6DA] flex-1 flex flex-col justify-between"
        role="region"
        aria-label="Interactive flight network map across 16 Indian airports"
      >
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-auto block select-none"
          role="group"
          aria-label="Airport nodes and flight corridors"
        >
          <title>Domino Sky Flight Network Atlas</title>
          <desc>
            Interactive airspace chart plotting 16 Indian airports by latitude and longitude with
            normal, delayed, and cancelled flight corridors.
          </desc>
          <defs>
            <radialGradient id="atlasVignette" cx="50%" cy="48%" r="62%">
              <stop offset="0%" stopColor="#F2EFE4" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#E4DFD0" stopOpacity="0.95" />
            </radialGradient>
          </defs>

          {/* Chart bed */}
          <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="url(#atlasVignette)" aria-hidden="true" />

          {/* Cartographic neatline frame + subtle lat/lng graticule */}
          <g aria-hidden="true">
            <rect
              x={10}
              y={10}
              width={SVG_W - 20}
              height={SVG_H - 20}
              fill="none"
              stroke="#C9C4B4"
              strokeWidth="1"
            />
            <rect
              x={PAD_X - 8}
              y={PAD_Y - 10}
              width={SVG_W - (PAD_X - 8) * 2}
              height={SVG_H - (PAD_Y - 10) * 2}
              fill="none"
              stroke="#D8D3C4"
              strokeWidth="0.75"
            />

            {[10, 15, 20, 25, 30].map((lat) => {
              const { y } = project(lat, MIN_LNG);
              return (
                <g key={`lat-${lat}`}>
                  <line
                    x1={PAD_X - 8}
                    y1={y}
                    x2={SVG_W - PAD_X + 8}
                    y2={y}
                    stroke="#D2CEC0"
                    strokeWidth="0.75"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={16}
                    y={y + 3}
                    fill="#676A60"
                    fontSize="9.5"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {lat}°N
                  </text>
                </g>
              );
            })}
            {[72, 77, 82, 87, 92].map((lng) => {
              const { x } = project(MIN_LAT, lng);
              return (
                <g key={`lng-${lng}`}>
                  <line
                    x1={x}
                    y1={PAD_Y - 10}
                    x2={x}
                    y2={SVG_H - PAD_Y + 10}
                    stroke="#D2CEC0"
                    strokeWidth="0.75"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={x - 13}
                    y={SVG_H - 17}
                    fill="#676A60"
                    fontSize="9.5"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {lng}°E
                  </text>
                </g>
              );
            })}

            {/* Indian landmass cartographic contour */}
            <path
              d={outlinePath}
              fill="#FAF8F2"
              fillOpacity="0.94"
              stroke="#BDB8A8"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />

            {/* Minimalist north reference & chart metadata stamp */}
            <g transform={`translate(${SVG_W - 88}, ${SVG_H - 64})`} opacity="0.78">
              <circle cx="0" cy="0" r="14" fill="none" stroke="#B7B3A4" strokeWidth="0.8" />
              <line x1="0" y1="-18" x2="0" y2="18" stroke="#B7B3A4" strokeWidth="0.8" />
              <line x1="-18" y1="0" x2="18" y2="0" stroke="#B7B3A4" strokeWidth="0.8" />
              <polygon points="0,-14 -3.2,-4 0,-6.5 3.2,-4" fill="#73766D" />
              <text
                x="0"
                y="-21"
                textAnchor="middle"
                fill="#5A5D54"
                fontSize="8.5"
                fontWeight="600"
                fontFamily="IBM Plex Mono, monospace"
              >
                N
              </text>
            </g>
          </g>

          {/* Flight corridors */}
          <g aria-hidden="true">
            {routes.map((route) => {
              const a = airportMap.get(route.origin);
              const b = airportMap.get(route.destination);
              if (!a || !b) return null;

              const isHovered = hoveredRouteKey === route.key;
              const touchesInspected =
                inspectedAirportId === route.origin || inspectedAirportId === route.destination;

              // Slight curve perpendicular to segment
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const offset = Math.min(28, len * 0.1);
              const cx = mx - (dy / len) * offset;
              const cy = my + (dx / len) * offset;
              const pathD = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;

              let stroke = '#7A7C70';
              let opacity = touchesInspected ? 0.62 : 0.28;
              let width = touchesInspected ? 1.5 : 1.05;
              let dash: string | undefined = undefined;

              if (route.severity === 'DELAYED') {
                stroke = '#D69A32';
                opacity = isHovered || touchesInspected ? 0.98 : 0.82;
                width = isHovered ? 2.9 : 2.1;
              } else if (route.severity === 'CANCELLED') {
                stroke = '#B84239';
                opacity = 0.95;
                width = isHovered ? 3.1 : 2.2;
                dash = '6 4';
              } else if (isHovered) {
                stroke = '#252923';
                opacity = 0.85;
                width = 2.1;
              }

              return (
                <g key={route.key}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={11}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredRouteKey(route.key)}
                    onMouseLeave={() => setHoveredRouteKey(null)}
                  />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width}
                    strokeOpacity={opacity}
                    strokeDasharray={dash}
                    strokeLinecap="round"
                    className="pointer-events-none transition-opacity duration-150"
                  />
                </g>
              );
            })}
          </g>

          {/* Airport nodes */}
          {airports.map((ap) => {
            const node = airportMap.get(ap.id)!;
            const st = airportStats.get(ap.id);
            const isClosed = closure?.airport === ap.id;
            const isSelected = selectedAirportId === ap.id;
            const hasCancelled = (st?.cancelled ?? 0) > 0;
            const hasDelayed = (st?.delayed ?? 0) > 0;

            let fill = '#252923';
            let ring = '#FFFEFA';
            if (isClosed) {
              fill = '#B84239';
              ring = '#FFFEFA';
            } else if (hasCancelled) {
              fill = '#B84239';
              ring = '#FFFEFA';
            } else if (hasDelayed) {
              fill = '#D69A32';
              ring = '#252923';
            }

            const radius = ap.tier === 'mega_hub' ? 6.2 : ap.tier === 'regional_hub' ? 4.8 : 3.9;

            // Label offset adjustments to avoid overlapping nearby nodes (e.g. BLR/MAA, BOM/PNQ)
            let labelDx = 10;
            let labelDy = 4;
            if (ap.id === 'PNQ') {
              labelDx = 10;
              labelDy = 10;
            } else if (ap.id === 'BOM') {
              labelDx = -38;
              labelDy = -2;
            } else if (ap.id === 'AMD') {
              labelDx = -38;
              labelDy = 3;
            } else if (ap.id === 'GOI') {
              labelDx = -34;
              labelDy = 4;
            } else if (ap.id === 'COK') {
              labelDx = -38;
              labelDy = 4;
            } else if (ap.id === 'BLR') {
              labelDx = -36;
              labelDy = -6;
            } else if (ap.id === 'DEL') {
              labelDx = -36;
              labelDy = -4;
            } else if (ap.id === 'JAI') {
              labelDx = -34;
              labelDy = 6;
            }

            const statusNote = isClosed
              ? 'closed'
              : hasCancelled
                ? 'has cancelled flights'
                : hasDelayed
                  ? 'has delayed flights'
                  : 'operating normally';

            return (
              <g
                key={ap.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-[#C76B43]"
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Select airport ${ap.id}, ${ap.city}, ${ap.tier.replace('_', ' ')}, ${statusNote}`}
                onClick={() => onSelectAirport(ap.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectAirport(ap.id);
                  }
                }}
                onFocus={() => setHoveredAirportId(ap.id)}
                onBlur={() => setHoveredAirportId(null)}
                onMouseEnter={() => setHoveredAirportId(ap.id)}
                onMouseLeave={() => setHoveredAirportId(null)}
              >
                {/* Invisible hit target for easy click/hover */}
                <circle r={17} fill="transparent" />

                {isClosed && (
                  <>
                    <circle
                      r={16}
                      fill="#B84239"
                      fillOpacity={0.14}
                      stroke="#B84239"
                      strokeWidth={1.6}
                      strokeDasharray="3 2"
                    />
                    <text
                      x={labelDx}
                      y={labelDy + 12}
                      fill="#962F28"
                      stroke="#FAF8F2"
                      strokeWidth={2.5}
                      style={{ paintOrder: 'stroke' }}
                      fontSize="9"
                      fontWeight="600"
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      CLOSED
                    </text>
                  </>
                )}

                {isSelected && !isClosed && (
                  <g aria-hidden="true">
                    <circle
                      r={12}
                      fill="#C76B43"
                      fillOpacity={0.1}
                      stroke="#C76B43"
                      strokeWidth={1.4}
                    />
                    <line x1={0} y1={-15} x2={0} y2={-11} stroke="#C76B43" strokeWidth={1.4} />
                    <line x1={0} y1={11} x2={0} y2={15} stroke="#C76B43" strokeWidth={1.4} />
                    <line x1={-15} y1={0} x2={-11} y2={0} stroke="#C76B43" strokeWidth={1.4} />
                    <line x1={11} y1={0} x2={15} y2={0} stroke="#C76B43" strokeWidth={1.4} />
                  </g>
                )}

                {ap.tier === 'mega_hub' ? (
                  <rect
                    x={-radius}
                    y={-radius}
                    width={radius * 2}
                    height={radius * 2}
                    rx={1.5}
                    fill={fill}
                    stroke={ring}
                    strokeWidth={1.6}
                  />
                ) : (
                  <circle
                    r={radius}
                    fill={fill}
                    stroke={ring}
                    strokeWidth={1.5}
                  />
                )}

                <text
                  x={labelDx}
                  y={labelDy}
                  fill={isClosed ? '#962F28' : isSelected ? '#9B4A27' : '#252923'}
                  stroke="#FAF8F2"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  style={{ paintOrder: 'stroke' }}
                  fontSize="11"
                  fontWeight="600"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {ap.id}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Inspector bar at bottom of SVG */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#F7F5EE] border-t border-[#DAD8CE] text-xs">
          {inspectedRoute ? (
            <div className="flex flex-wrap items-center gap-2.5 text-[#252923]">
              <span className="font-mono font-semibold text-[#9B4A27]">
                {inspectedRoute.origin} ↔ {inspectedRoute.destination}
              </span>
              <span className="text-[#9E9B8F]">·</span>
              <span className="tabular-nums font-mono text-[#252923]">
                {inspectedRoute.flightCount} scheduled legs
              </span>
              <span className="text-[#9E9B8F]">·</span>
              <span className="tabular-nums font-mono text-[#875B0E] font-medium">
                {inspectedRoute.delayedCount} delayed
              </span>
              <span className="text-[#9E9B8F]">·</span>
              <span className="tabular-nums font-mono text-[#B84239] font-medium">
                {inspectedRoute.cancelledCount} cancelled
              </span>
              <span className="text-[#9E9B8F]">·</span>
              <span className="font-mono text-[#5F6259] truncate max-w-[260px]">
                {inspectedRoute.flightIds.join(', ')}
              </span>
            </div>
          ) : inspectedAirport ? (
            <div className="flex flex-wrap items-center gap-2.5 text-[#252923]">
              <span className="font-mono font-semibold text-[#9B4A27]">
                {inspectedAirport.id}
              </span>
              <span className="font-medium">
                {inspectedAirport.city} — {inspectedAirport.name}
              </span>
              <span className="text-[#9E9B8F]">·</span>
              <span className="text-[#5F6259] capitalize">
                {inspectedAirport.tier.replace('_', ' ')} ({inspectedAirport.capacity_per_hour}/hr)
              </span>
              {inspectedStats && (
                <>
                  <span className="text-[#9E9B8F]">·</span>
                  <span className="tabular-nums font-mono text-[#252923]">
                    {inspectedStats.depTotal} dep / {inspectedStats.arrTotal} arr
                  </span>
                </>
              )}
            </div>
          ) : (
            <span className="text-[#5F6259]">Hover a route or airport node for details.</span>
          )}

          <div className="flex items-center gap-2.5 text-[11px] font-mono text-[#5F6259]">
            <span>Square: Mega Hub</span>
            <span>·</span>
            <span>Circle: Regional / Spoke</span>
          </div>
        </div>
      </div>
    </div>
  );
};
