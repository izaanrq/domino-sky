import React, { useMemo, useState } from 'react';
import { formatMinutes } from '../engine/time';
import type { AirportClosure, FlightSimulationResult } from '../engine/types';

interface CascadeTimelineProps {
  flights: FlightSimulationResult[];
  closure: AirportClosure | null;
  onInspectFlight?: (flightId: string) => void;
}

const DAY_START = 5 * 60; // 05:00 IST
const DEFAULT_DAY_END = 23 * 60; // 23:00 IST

export const CascadeTimeline: React.FC<CascadeTimelineProps> = ({
  flights,
  closure,
  onInspectFlight,
}) => {
  const [onlyAffectedTails, setOnlyAffectedTails] = useState(true);
  const [hoveredFlightId, setHoveredFlightId] = useState<string | null>(null);

  const maxTime = useMemo(() => {
    let max = DEFAULT_DAY_END;
    for (const f of flights) {
      if (f.actualArr !== null && f.actualArr + 30 > max) max = f.actualArr + 30;
      if (f.scheduledArr + 30 > max) max = f.scheduledArr + 30;
    }
    return Math.ceil(max / 60) * 60;
  }, [flights]);

  const totalSpan = maxTime - DAY_START;

  const rotations = useMemo(() => {
    const byTail = new Map<string, FlightSimulationResult[]>();
    for (const f of flights) {
      const list = byTail.get(f.originalTailId) ?? [];
      list.push(f);
      byTail.set(f.originalTailId, list);
    }

    const rows = Array.from(byTail.entries())
      .map(([tailId, legs]) => {
        legs.sort((a, b) => a.legOrder - b.legOrder);
        const affected = legs.some((l) => l.status !== 'ON_TIME' || l.substitutedBySpare);
        return { tailId, legs, affected };
      })
      .sort((a, b) => a.tailId.localeCompare(b.tailId));

    if (!onlyAffectedTails) return rows;
    const filtered = rows.filter((r) => r.affected);
    return filtered.length > 0 ? filtered : rows;
  }, [flights, onlyAffectedTails]);

  const hourTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let m = DAY_START; m <= maxTime; m += 120) {
      ticks.push(m);
    }
    return ticks;
  }, [maxTime]);

  const toPct = (mins: number) =>
    Math.max(0, Math.min(100, ((mins - DAY_START) / totalSpan) * 100));

  const closureLeftPct = closure ? toPct(closure.startMinutes) : 0;
  const closureWidthPct = closure
    ? Math.max(0.5, toPct(closure.startMinutes + closure.durationMinutes) - closureLeftPct)
    : 0;

  const hoveredFlight = hoveredFlightId
    ? flights.find((f) => f.flightId === hoveredFlightId)
    : undefined;

  return (
    <section
      id="timeline"
      aria-label="Aircraft Rotation Cascade Timeline"
      className="bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#DAD8CE]">
        <div>
          <h2 className="text-base font-semibold text-[#252923] tracking-tight">
            Aircraft Rotation Cascade Timeline
          </h2>
          <p className="text-xs text-[#5F6259]">
            Dashed outline: scheduled leg · Solid bar: actual operated leg · Red shaded band: airport closure
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Filter timeline aircraft"
            className="flex items-center gap-1 p-1 bg-[#F2F0E8] rounded border border-[#DAD8CE]"
          >
            <button
              type="button"
              aria-pressed={onlyAffectedTails}
              onClick={() => setOnlyAffectedTails(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                onlyAffectedTails
                  ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                  : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
              }`}
            >
              Affected Aircraft
            </button>
            <button
              type="button"
              aria-pressed={!onlyAffectedTails}
              onClick={() => setOnlyAffectedTails(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !onlyAffectedTails
                  ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                  : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
              }`}
            >
              All 16 Aircraft
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 overflow-x-auto">
        <div className="min-w-[780px]">
          {/* Time axis */}
          <div className="flex items-center mb-2">
            <div className="w-24 shrink-0 text-[11px] font-mono uppercase tracking-[0.06em] font-semibold text-[#5A5D54]">
              Tail
            </div>
            <div className="flex-1 relative h-5 border-b border-[#DAD8CE]">
              {hourTicks.map((t) => (
                <div
                  key={t}
                  style={{ left: `${toPct(t)}%` }}
                  className="absolute top-0 -translate-x-1/2 text-[10px] font-mono tabular-nums text-[#5F6259]"
                >
                  {formatMinutes(t)}
                </div>
              ))}
            </div>
          </div>

          {/* Swimlanes */}
          <div className="relative space-y-2">
            {/* Closure band overlay */}
            {closure && (
              <div
                style={{
                  left: `calc(6rem + (100% - 6rem) * ${closureLeftPct / 100})`,
                  width: `calc((100% - 6rem) * ${closureWidthPct / 100})`,
                }}
                className="absolute top-0 bottom-0 bg-[#B84239]/12 border-x border-[#B84239]/55 pointer-events-none z-0"
                title={`Closure at ${closure.airport}: ${formatMinutes(closure.startMinutes)}–${formatMinutes(closure.startMinutes + closure.durationMinutes)}`}
              />
            )}

            {rotations.map((row) => (
              <div key={row.tailId} className="flex items-center h-9 relative z-10">
                <div className="w-24 shrink-0 pr-2 flex flex-col">
                  <span className="text-xs font-mono font-semibold text-[#252923]">
                    {row.tailId}
                  </span>
                  <span className="text-[10px] font-mono text-[#73766D]">
                    {row.legs[0]?.origin} base
                  </span>
                </div>

                <div className="flex-1 h-8 bg-[#F5F2EA] border border-[#DAD8CE] rounded-sm relative overflow-hidden">
                  {/* Hour gridlines */}
                  {hourTicks.map((t) => (
                    <div
                      key={t}
                      style={{ left: `${toPct(t)}%` }}
                      className="absolute top-0 bottom-0 w-px bg-[#DFDDD2] pointer-events-none"
                    />
                  ))}

                  {/* Scheduled outlines */}
                  {row.legs.map((leg) => {
                    const left = toPct(leg.scheduledDep);
                    const width = Math.max(0.8, toPct(leg.scheduledArr) - left);
                    return (
                      <div
                        key={`sched-${leg.flightId}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        className="absolute top-1 bottom-1 border border-dashed border-[#8E9085] rounded-sm pointer-events-none"
                      />
                    );
                  })}

                  {/* Actual flight bars */}
                  {row.legs.map((leg) => {
                    const isCancelled = leg.status === 'CANCELLED';
                    const start = isCancelled ? leg.scheduledDep : leg.actualDep!;
                    const end = isCancelled ? leg.scheduledArr : leg.actualArr!;
                    const left = toPct(start);
                    const width = Math.max(1.2, toPct(end) - left);

                    let barClass =
                      'bg-[#3A3E36] border-[#252923] text-[#FFFEFA] hover:bg-[#252923]';
                    if (leg.substitutedBySpare) {
                      barClass =
                        'bg-[#65866B]/25 border-[#4E6E54] text-[#233827] hover:bg-[#65866B]/38';
                    } else if (isCancelled) {
                      barClass =
                        'bg-[#B84239]/14 border-[#B84239] border-dashed text-[#8E2922] hover:bg-[#B84239]/24';
                    } else if (leg.status === 'DELAYED') {
                      barClass =
                        'bg-[#D69A32]/26 border-[#B87D14] text-[#523606] hover:bg-[#D69A32]/40';
                    }

                    return (
                      <button
                        key={leg.flightId}
                        type="button"
                        onClick={() => onInspectFlight?.(leg.flightId)}
                        onMouseEnter={() => setHoveredFlightId(leg.flightId)}
                        onMouseLeave={() => setHoveredFlightId(null)}
                        onFocus={() => setHoveredFlightId(leg.flightId)}
                        onBlur={() => setHoveredFlightId(null)}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        className={`absolute top-1 bottom-1 border rounded-sm px-1 flex items-center justify-center overflow-hidden text-[10px] font-mono tabular-nums font-medium transition-colors cursor-pointer ${barClass}`}
                        title={`${leg.flightId} ${leg.origin}→${leg.destination} (${leg.status})`}
                      >
                        <span className="truncate">
                          {leg.flightId.replace('DS', '')}
                          {leg.delayMinutes > 0 ? ` +${leg.delayMinutes}m` : ''}
                          {isCancelled ? ' X' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live flight bar readout */}
      <div className="px-4 py-2.5 bg-[#F7F5EE] border-t border-[#DAD8CE] text-xs flex flex-wrap items-center justify-between gap-2 min-h-[38px]">
        {hoveredFlight ? (
          <div className="flex flex-wrap items-center gap-2.5 text-[#252923]">
            <span className="font-mono font-semibold text-[#9B4A27]">{hoveredFlight.flightId}</span>
            <span className="font-mono font-medium">
              {hoveredFlight.origin}→{hoveredFlight.destination}
            </span>
            <span className="text-[#9E9B8F]">·</span>
            <span className="font-mono text-[#5A5D54]">
              Tail: {hoveredFlight.operatingTailId}
              {hoveredFlight.substitutedBySpare ? ` (spare for ${hoveredFlight.originalTailId})` : ''}
            </span>
            <span className="text-[#9E9B8F]">·</span>
            <span className="font-mono tabular-nums text-[#5A5D54]">
              Sched {formatMinutes(hoveredFlight.scheduledDep)}–{formatMinutes(hoveredFlight.scheduledArr)}
            </span>
            {hoveredFlight.actualDep !== null && (
              <>
                <span className="text-[#9E9B8F]">·</span>
                <span className="font-mono tabular-nums font-semibold text-[#875B0E]">
                  Actual {formatMinutes(hoveredFlight.actualDep)}–{formatMinutes(hoveredFlight.actualArr)}
                </span>
              </>
            )}
            <span className="text-[#9E9B8F]">·</span>
            <span className="text-[#252923]">{hoveredFlight.explanation}</span>
          </div>
        ) : (
          <span className="text-[#5F6259]">
            Hover or focus any flight bar to trace turnaround propagation and closure delays.
          </span>
        )}
      </div>
    </section>
  );
};
