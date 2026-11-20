import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Search, XCircle } from 'lucide-react';
import { formatMinutes } from '../engine/time';
import type { FlightSimulationResult } from '../engine/types';

interface FlightImpactTableProps {
  flights: FlightSimulationResult[];
  highlightedFlightId?: string | null;
}

type StatusFilter = 'ALL' | 'AFFECTED' | 'DELAYED' | 'CANCELLED' | 'ON_TIME';

export const FlightImpactTable: React.FC<FlightImpactTableProps> = ({
  flights,
  highlightedFlightId,
}) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [aircraftFilter, setAircraftFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const aircraftOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flights) {
      set.add(f.originalTailId);
      if (f.operatingTailId !== f.originalTailId) set.add(f.operatingTailId);
    }
    return Array.from(set).sort();
  }, [flights]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return flights.filter((f) => {
      if (statusFilter === 'AFFECTED' && f.status === 'ON_TIME') return false;
      if (statusFilter === 'DELAYED' && f.status !== 'DELAYED') return false;
      if (statusFilter === 'CANCELLED' && f.status !== 'CANCELLED') return false;
      if (statusFilter === 'ON_TIME' && f.status !== 'ON_TIME') return false;

      if (
        aircraftFilter !== 'ALL' &&
        f.originalTailId !== aircraftFilter &&
        f.operatingTailId !== aircraftFilter
      ) {
        return false;
      }

      if (q) {
        const hay = `${f.flightId} ${f.origin} ${f.destination} ${f.operatingTailId} ${f.explanation}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [flights, statusFilter, aircraftFilter, searchQuery]);

  const counts = useMemo(() => {
    let affected = 0;
    let delayed = 0;
    let cancelled = 0;
    for (const f of flights) {
      if (f.status === 'DELAYED') {
        delayed++;
        affected++;
      } else if (f.status === 'CANCELLED') {
        cancelled++;
        affected++;
      }
    }
    return { total: flights.length, affected, delayed, cancelled };
  }, [flights]);

  return (
    <section
      id="flights"
      aria-label="Flight Impact Table"
      className="bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#DAD8CE]">
        <div>
          <h2 className="text-base font-semibold text-[#252923] tracking-tight">
            Flight Schedule &amp; Impact Log
          </h2>
          <p className="text-xs text-[#5F6259]">
            Showing {filtered.length} of {counts.total} flights · All times IST
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Segmented status filter */}
          <div
            role="group"
            aria-label="Filter flights by status"
            className="flex items-center gap-1 p-1 bg-[#F2F0E8] rounded border border-[#DAD8CE]"
          >
            {(
              [
                { id: 'ALL', label: `All (${counts.total})` },
                { id: 'AFFECTED', label: `Affected (${counts.affected})` },
                { id: 'DELAYED', label: `Delayed (${counts.delayed})` },
                { id: 'CANCELLED', label: `Cancelled (${counts.cancelled})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={statusFilter === tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                    : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Aircraft selector */}
          <label className="sr-only" htmlFor="aircraft-filter">
            Filter by aircraft tail
          </label>
          <select
            id="aircraft-filter"
            value={aircraftFilter}
            onChange={(e) => setAircraftFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono bg-[#F7F5EE] border border-[#DAD8CE] rounded-sm text-[#252923] focus:outline-none focus:border-[#C76B43]"
          >
            <option value="ALL">All Aircraft</option>
            {aircraftOptions.map((tail) => (
              <option key={tail} value={tail}>
                {tail}
              </option>
            ))}
          </select>

          {/* Search input */}
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-[#73766D] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label className="sr-only" htmlFor="flight-search">
              Search flights or airports
            </label>
            <input
              id="flight-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search flight / IATA..."
              className="pl-8 pr-3 py-1.5 text-xs bg-[#F7F5EE] border border-[#DAD8CE] rounded-sm text-[#252923] placeholder:text-[#73766D] focus:outline-none focus:border-[#C76B43] w-44"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[520px]">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-[#EFECE3] border-b border-[#DAD8CE] text-[11px] uppercase tracking-[0.06em] text-[#5A5D54]">
            <tr>
              <th className="py-2.5 px-3 font-semibold">Flight</th>
              <th className="py-2.5 px-3 font-semibold">Route</th>
              <th className="py-2.5 px-3 font-semibold">Aircraft</th>
              <th className="py-2.5 px-3 font-semibold text-right">Sched Dep</th>
              <th className="py-2.5 px-3 font-semibold text-right">Actual Dep</th>
              <th className="py-2.5 px-3 font-semibold text-right">Sched Arr</th>
              <th className="py-2.5 px-3 font-semibold text-right">Actual Arr</th>
              <th className="py-2.5 px-3 font-semibold text-right">Delay</th>
              <th className="py-2.5 px-3 font-semibold">Status</th>
              <th className="py-2.5 px-3 font-semibold">Causal Explanation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DAD8CE]/75">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-[#5F6259]">
                  No flights match the active filters.
                </td>
              </tr>
            ) : (
              filtered.map((f) => {
                const isHighlighted = highlightedFlightId === f.flightId;
                const rowTone = isHighlighted
                  ? 'bg-[#C76B43]/12'
                  : f.status === 'CANCELLED'
                    ? 'bg-[#B84239]/[0.03] hover:bg-[#B84239]/[0.07]'
                    : f.status === 'DELAYED'
                      ? 'bg-[#D69A32]/[0.04] hover:bg-[#D69A32]/[0.09]'
                      : 'hover:bg-[#F7F5EE]';
                return (
                  <tr key={f.flightId} className={`transition-colors ${rowTone}`}>
                    <td className="py-2.5 px-3 font-mono font-semibold text-[#252923] whitespace-nowrap">
                      {f.flightId}
                      <span className="text-[#73766D] font-normal ml-1">L{f.legOrder}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#252923] whitespace-nowrap">
                      {f.origin} → {f.destination}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      <span
                        className={
                          f.substitutedBySpare ? 'text-[#3B5740] font-semibold' : 'text-[#5A5D54]'
                        }
                      >
                        {f.operatingTailId}
                      </span>
                      {f.substitutedBySpare && (
                        <span className="text-[11px] text-[#73766D] ml-1">
                          (was {f.originalTailId})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#5F6259] whitespace-nowrap">
                      {formatMinutes(f.scheduledDep)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap ${
                        f.status === 'DELAYED'
                          ? 'text-[#875B0E] font-medium'
                          : f.status === 'CANCELLED'
                            ? 'text-[#73766D]'
                            : 'text-[#252923]'
                      }`}
                    >
                      {formatMinutes(f.actualDep)}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#5F6259] whitespace-nowrap">
                      {formatMinutes(f.scheduledArr)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap ${
                        f.status === 'DELAYED'
                          ? 'text-[#875B0E] font-medium'
                          : f.status === 'CANCELLED'
                            ? 'text-[#73766D]'
                            : 'text-[#252923]'
                      }`}
                    >
                      {formatMinutes(f.actualArr)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap ${
                        f.delayMinutes > 0 ? 'text-[#875B0E] font-semibold' : 'text-[#73766D]'
                      }`}
                    >
                      {f.status === 'CANCELLED' ? '—' : `+${f.delayMinutes}m`}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {f.status === 'ON_TIME' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#65866B]/12 text-[#3B5740] border border-[#65866B]/35 font-medium">
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          On Time
                        </span>
                      )}
                      {f.status === 'DELAYED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#D69A32]/15 text-[#875B0E] border border-[#D69A32]/45 font-medium">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          Delayed
                        </span>
                      )}
                      {f.status === 'CANCELLED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#B84239]/12 text-[#962F28] border border-[#B84239]/35 font-medium">
                          <XCircle className="w-3 h-3" aria-hidden="true" />
                          Cancelled
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[#252923] min-w-[260px] leading-relaxed">
                      {f.explanation}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
