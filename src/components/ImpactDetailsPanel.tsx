import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { formatDurationMins, formatMinutes } from '../engine/time';
import type { SimulationResult } from '../engine/types';

interface ImpactDetailsPanelProps {
  simulation: SimulationResult;
}

type DetailTab = 'connections' | 'crews' | 'passengers';

export const ImpactDetailsPanel: React.FC<ImpactDetailsPanelProps> = React.memo(({ simulation }) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('connections');
  const [onlyDisruptedCx, setOnlyDisruptedCx] = useState(false);

  const visibleConnections = useMemo(() => {
    const list = onlyDisruptedCx
      ? simulation.connections.filter((c) => c.disrupted)
      : simulation.connections;
    return [...list].sort((a, b) => Number(b.disrupted) - Number(a.disrupted));
  }, [simulation.connections, onlyDisruptedCx]);

  const sortedCrews = useMemo(() => {
    return [...simulation.crews].sort((a, b) => {
      if (a.violation !== b.violation) return Number(b.violation) - Number(a.violation);
      const aHead = a.remainingHeadroomMinutes ?? 9999;
      const bHead = b.remainingHeadroomMinutes ?? 9999;
      return aHead - bHead;
    });
  }, [simulation.crews]);

  return (
    <div className="flex flex-col bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#DAD8CE]">
        <div
          role="tablist"
          aria-label="Impact details"
          className="flex items-center gap-1 p-1 bg-[#F2F0E8] rounded border border-[#DAD8CE]"
        >
          <button
            type="button"
            id="tab-connections"
            role="tab"
            aria-selected={activeTab === 'connections'}
            aria-controls="panel-connections"
            onClick={() => setActiveTab('connections')}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'connections'
                ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
            }`}
          >
            Connections ({simulation.summary.disruptedConnectionsCount}/{simulation.connections.length})
          </button>
          <button
            type="button"
            id="tab-crews"
            role="tab"
            aria-selected={activeTab === 'crews'}
            aria-controls="panel-crews"
            onClick={() => setActiveTab('crews')}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'crews'
                ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
            }`}
          >
            Crew Duty ({simulation.summary.crewDutyViolations} viol.)
          </button>
          <button
            type="button"
            id="tab-passengers"
            role="tab"
            aria-selected={activeTab === 'passengers'}
            aria-controls="panel-passengers"
            onClick={() => setActiveTab('passengers')}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'passengers'
                ? 'bg-[#FFFEFA] text-[#252923] border border-[#DAD8CE] shadow-[0_1px_2px_rgba(37,41,35,0.06)]'
                : 'text-[#5A5D54] hover:text-[#252923] border border-transparent'
            }`}
          >
            Passenger Lenses
          </button>
        </div>

        {activeTab === 'connections' && (
          <button
            type="button"
            aria-pressed={onlyDisruptedCx}
            onClick={() => setOnlyDisruptedCx((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded-sm border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              onlyDisruptedCx
                ? 'border-[#B84239] bg-[#B84239]/10 text-[#962F28]'
                : 'border-[#DAD8CE] bg-[#F7F5EE] text-[#5A5D54] hover:text-[#252923] hover:border-[#BDB9AC]'
            }`}
          >
            {onlyDisruptedCx ? 'Showing Disrupted' : 'Filter Disrupted'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto max-h-[540px]">
        {activeTab === 'connections' && (
          <div
            id="panel-connections"
            role="tabpanel"
            aria-labelledby="tab-connections"
            className="divide-y divide-[#DAD8CE]/80"
          >
            {visibleConnections.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#5F6259]">
                No disrupted passenger connections under this scenario.
              </div>
            ) : (
              visibleConnections.map((cx) => (
                <div
                  key={cx.connectionId}
                  className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-[#F7F5EE] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#252923]">
                        {cx.connectionId}
                      </span>
                      <span className="text-[#A09D92]">·</span>
                      <span className="font-mono font-semibold text-[#9B4A27]">{cx.airport}</span>
                      <span className="text-[#A09D92]">·</span>
                      <span className="font-mono text-[#252923]">
                        {cx.fromFlightId} → {cx.toFlightId}
                      </span>
                      <span className="text-[#A09D92]">·</span>
                      <span className="font-mono tabular-nums text-[#5A5D54]">
                        {cx.passengers} pax
                      </span>
                    </div>
                    <p className="text-xs text-[#5F6259] mt-1 leading-relaxed">{cx.explanation}</p>
                  </div>

                  <div className="shrink-0 text-right">
                    {cx.disrupted ? (
                      cx.status === 'DISRUPTED_CANCELLED' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium bg-[#B84239]/12 text-[#962F28] border border-[#B84239]/35">
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium bg-[#C76B43]/14 text-[#8F3F1D] border border-[#C76B43]/40">
                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          Missed
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium bg-[#65866B]/14 text-[#3B5740] border border-[#65866B]/40">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Made ({cx.actualConnectMinutes}m)
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'crews' && (
          <div
            id="panel-crews"
            role="tabpanel"
            aria-labelledby="tab-crews"
            className="overflow-x-auto"
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#DAD8CE] text-[11px] uppercase tracking-[0.06em] text-[#5A5D54] bg-[#EFECE3]">
                  <th className="py-2.5 px-3 font-semibold">Crew</th>
                  <th className="py-2.5 px-3 font-semibold">Tail</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Duty</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Max</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Headroom</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DAD8CE]/75">
                {sortedCrews.map((cr) => (
                  <tr key={cr.crewId} className="hover:bg-[#F7F5EE] transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium text-[#252923]">
                      {cr.crewId}
                      <span className="text-[#73766D] ml-1.5">({cr.base})</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#5A5D54]">{cr.tailId}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#252923]">
                      {cr.evaluated ? (
                        <span
                          title={`Start ${formatMinutes(cr.dutyStartMinutes)} · End ${formatMinutes(cr.lastOperatedArrival)}`}
                        >
                          {formatDurationMins(cr.dutyMinutes)}
                        </span>
                      ) : (
                        <span className="text-[#5F6259]">Not evaluated</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#5F6259]">
                      {formatDurationMins(cr.maxDutyMinutes)}
                    </td>
                    <td
                      className={`py-2.5 px-3 font-mono tabular-nums text-right ${
                        !cr.evaluated
                          ? 'text-[#73766D]'
                          : cr.violation
                            ? 'text-[#B84239] font-semibold'
                            : (cr.remainingHeadroomMinutes ?? 999) <= 30
                              ? 'text-[#875B0E] font-medium'
                              : 'text-[#252923]'
                      }`}
                    >
                      {cr.evaluated ? formatDurationMins(cr.remainingHeadroomMinutes) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {!cr.evaluated ? (
                        <span className="text-[#5F6259]">Not evaluated</span>
                      ) : cr.violation ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#B84239]/12 text-[#962F28] border border-[#B84239]/35 font-medium">
                          <AlertCircle className="w-3 h-3" aria-hidden="true" />
                          Violation (+{cr.overageMinutes}m)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#65866B]/12 text-[#3B5740] border border-[#65866B]/35 font-medium">
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          Compliant
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'passengers' && (
          <div
            id="panel-passengers"
            role="tabpanel"
            aria-labelledby="tab-passengers"
            className="p-4 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-sm bg-[#F7F5EE] border border-[#DAD8CE]">
                <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[#5A5D54]">
                  Disrupted connection pax-events
                </div>
                <div className="text-xl font-mono tabular-nums font-semibold text-[#B84239] mt-1">
                  {simulation.passengerImpact.disruptedConnectionPaxEvents.toLocaleString()}
                </div>
                <div className="text-xs text-[#5F6259] mt-0.5">
                  Across {simulation.passengerImpact.disruptedConnectionsCount} connection records
                </div>
              </div>
              <div className="p-3.5 rounded-sm bg-[#F7F5EE] border border-[#DAD8CE]">
                <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[#5A5D54]">
                  Passengers on cancelled flights
                </div>
                <div className="text-xl font-mono tabular-nums font-semibold text-[#B84239] mt-1">
                  {simulation.passengerImpact.passengersOnCancelledFlights.toLocaleString()}
                </div>
                <div className="text-xs text-[#5F6259] mt-0.5">
                  Across {simulation.summary.cancelledFlights} cancelled flights
                </div>
              </div>
              <div className="p-3.5 rounded-sm bg-[#F7F5EE] border border-[#DAD8CE]">
                <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[#5A5D54]">
                  Passengers on delayed operated flights
                </div>
                <div className="text-xl font-mono tabular-nums font-semibold text-[#875B0E] mt-1">
                  {simulation.passengerImpact.passengersOnDelayedOperatedFlights.toLocaleString()}
                </div>
                <div className="text-xs text-[#5F6259] mt-0.5">
                  Across {simulation.summary.delayedFlights} delayed flights
                </div>
              </div>
              <div className="p-3.5 rounded-sm bg-[#F7F5EE] border border-[#DAD8CE]">
                <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-[#5A5D54]">
                  Passenger-leg delay minutes
                </div>
                <div className="text-xl font-mono tabular-nums font-semibold text-[#875B0E] mt-1">
                  {simulation.passengerImpact.passengerLegDelayMinutes.toLocaleString()}
                </div>
                <div className="text-xs text-[#5F6259] mt-0.5">
                  Sum of (flight pax × arrival delay min)
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-sm bg-[#F2F0E8] border border-[#DAD8CE] text-xs text-[#4C4F47] leading-relaxed">
              <Info className="w-4 h-4 text-[#9B4A27] shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                These metrics represent distinct operational impact dimensions. Because the dataset
                does not contain individual passenger itineraries or PNR IDs, these counts must not
                be summed into a combined unique stranded passenger figure. Each disrupted
                connection record is counted once even if both connecting flights are cancelled.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
