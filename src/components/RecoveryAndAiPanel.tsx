import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import type {
  AIDispatchRecommendation,
  RecoveryCandidate,
  SimulationResult,
} from '../engine/types';

interface RecoveryAndAiPanelProps {
  originalSimulation: SimulationResult;
  rankedFeasible: RecoveryCandidate[];
  infeasible: RecoveryCandidate[];
  selectedCandidateId: string;
  onSelectCandidate: (candidateId: string) => void;
  aiRecommendation: AIDispatchRecommendation | null;
  aiLoading: boolean;
  onRequestAiDispatch: () => void;
}

export const RecoveryAndAiPanel: React.FC<RecoveryAndAiPanelProps> = React.memo(({
  originalSimulation,
  rankedFeasible,
  infeasible,
  selectedCandidateId,
  onSelectCandidate,
  aiRecommendation,
  aiLoading,
  onRequestAiDispatch,
}) => {
  const [showInfeasible, setShowInfeasible] = useState(false);

  const selectedCandidate =
    rankedFeasible.find((c) => c.id === selectedCandidateId) ?? rankedFeasible[0];

  const hasDisruption =
    originalSimulation.summary.delayedFlights > 0 ||
    originalSimulation.summary.cancelledFlights > 0 ||
    originalSimulation.summary.disruptedConnectionsCount > 0 ||
    originalSimulation.summary.crewDutyViolations > 0;

  const orig = originalSimulation.summary;
  const rec = selectedCandidate?.metrics ?? orig;

  const comparisonRows = [
    {
      label: 'Delayed flights',
      before: orig.delayedFlights,
      after: rec.delayedFlights,
      unit: '',
    },
    {
      label: 'Cancelled flights',
      before: orig.cancelledFlights,
      after: rec.cancelledFlights,
      unit: '',
    },
    {
      label: 'Disrupted connection pax-events',
      before: orig.disruptedConnectionPaxEvents,
      after: rec.disruptedConnectionPaxEvents,
      unit: '',
    },
    {
      label: 'Disrupted connections',
      before: orig.disruptedConnectionsCount,
      after: rec.disruptedConnectionsCount,
      unit: '',
    },
    {
      label: 'Passengers on cancelled flights',
      before: orig.passengersOnCancelledFlights,
      after: rec.passengersOnCancelledFlights,
      unit: '',
    },
    {
      label: 'Passenger-leg delay minutes',
      before: orig.passengerLegDelayMinutes,
      after: rec.passengerLegDelayMinutes,
      unit: 'm',
    },
    {
      label: 'Total arrival-delay minutes',
      before: orig.totalArrivalDelayMinutes,
      after: rec.totalArrivalDelayMinutes,
      unit: 'm',
    },
    {
      label: 'Crew duty violations',
      before: orig.crewDutyViolations,
      after: rec.crewDutyViolations,
      unit: '',
    },
  ];

  return (
    <section id="recovery" aria-label="Recovery Engine and AI Dispatcher" className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Deterministic Lexicographic Recovery Rankings */}
        <div className="xl:col-span-7 bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#DAD8CE]">
            <div>
              <h2 className="text-base font-semibold text-[#252923] tracking-tight">
                Deterministic Recovery Rankings
              </h2>
              <p className="text-xs text-[#5F6259]">
                Lexicographic sort: Duty violations → Overage → Cancel pax → Cancels → CX pax → Pax-delay → Delay min
              </p>
            </div>
            <span className="text-xs font-mono text-[#5A5D54]">
              {rankedFeasible.length} feasible · {infeasible.length} infeasible
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#DAD8CE] text-[11px] uppercase tracking-[0.06em] text-[#5A5D54] bg-[#EFECE3]">
                  <th className="py-2.5 px-3 font-semibold">Rank</th>
                  <th className="py-2.5 px-3 font-semibold">Recovery Action</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">Duty Viol.</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">Cancel Pax</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">Cancels</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">CX Pax</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">Pax-Delay</th>
                  <th className="py-2.5 px-2.5 font-semibold text-right">Arr Delay</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Compare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DAD8CE]/75">
                {rankedFeasible.slice(0, 12).map((cand) => {
                  const m = cand.metrics!;
                  const isSelected = cand.id === selectedCandidate?.id;
                  const isAiPick =
                    aiRecommendation?.validatedFeasible &&
                    aiRecommendation.recommendedCandidateId === cand.id;

                  return (
                    <tr
                      key={cand.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-[#65866B]/10' : 'hover:bg-[#F7F5EE]'
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#5A5D54] font-semibold">
                        #{cand.rank}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[#252923]">{cand.label}</span>
                          {cand.improvesOverBaseline && (
                            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#3B5740]">
                              Improves
                            </span>
                          )}
                          {isAiPick && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9B4A27]">
                              <Bot className="w-3 h-3" aria-hidden="true" />
                              AI Pick
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#5F6259] mt-0.5">
                          {cand.description}
                          {cand.assumptions.length > 0 && (
                            <span className="text-[#73766D]"> · {cand.assumptions[0]}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right">
                        <span className={m.crewDutyViolations > 0 ? 'text-[#B84239] font-semibold' : 'text-[#252923]'}>
                          {m.crewDutyViolations}
                        </span>
                        {m.totalCrewDutyOverageMinutes > 0 && (
                          <span className="block text-[10px] text-[#B84239]">
                            +{m.totalCrewDutyOverageMinutes}m
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right text-[#252923]">
                        {m.passengersOnCancelledFlights}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right text-[#252923]">
                        {m.cancelledFlights}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right text-[#252923]">
                        {m.disruptedConnectionPaxEvents}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right text-[#252923]">
                        {m.passengerLegDelayMinutes.toLocaleString()}m
                      </td>
                      <td className="py-2.5 px-2.5 font-mono tabular-nums text-right text-[#252923]">
                        {m.totalArrivalDelayMinutes}m
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectCandidate(cand.id)}
                          className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isSelected
                              ? 'bg-[#4A6A50] text-[#FFFEFA] border border-[#4A6A50]'
                              : 'bg-[#F5F2EA] text-[#252923] hover:bg-[#EAE7DC] border border-[#DAD8CE]'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {infeasible.length > 0 && (
            <div className="border-t border-[#DAD8CE]">
              <button
                type="button"
                onClick={() => setShowInfeasible((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-[#5A5D54] hover:text-[#252923] hover:bg-[#F7F5EE] transition-colors cursor-pointer"
              >
                <span>
                  {infeasible.length} infeasible spare substitution candidate(s) filtered out
                </span>
                {showInfeasible ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
              {showInfeasible && (
                <div className="px-4 pb-3 space-y-2 border-t border-[#DAD8CE]/70 pt-2.5 bg-[#F9F7F1]">
                  {infeasible.map((inf) => (
                    <div
                      key={inf.id}
                      className="text-xs flex flex-wrap justify-between gap-2 text-[#5A5D54]"
                    >
                      <span className="font-mono text-[#252923]">{inf.label}</span>
                      <span className="text-[#962F28]">{inf.infeasibilityReason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 5 cols: AI Dispatcher + Before/After Comparison */}
        <div className="xl:col-span-5 space-y-6">
          {/* AI Dispatcher */}
          <div className="bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#DAD8CE]">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#9B4A27]" aria-hidden="true" />
                <h2 className="text-base font-semibold text-[#252923] tracking-tight">
                  AI Dispatcher
                </h2>
              </div>
              <button
                type="button"
                onClick={onRequestAiDispatch}
                disabled={aiLoading || !hasDisruption}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-[#B1552F] hover:bg-[#9A4624] disabled:bg-[#EAE7DC] disabled:text-[#73766D] text-[#FFFEFA] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                {aiLoading ? 'Analyzing...' : aiRecommendation ? 'Refresh AI Brief' : 'Analyze Disruption'}
              </button>
            </div>

            <div className="p-4 text-xs space-y-3">
              {!hasDisruption ? (
                <p className="text-[#5F6259] leading-relaxed">
                  Run an airport closure scenario with active delays or disruptions to request an AI
                  dispatcher briefing.
                </p>
              ) : aiLoading ? (
                <div className="space-y-2.5 animate-pulse" aria-busy="true">
                  <div className="h-3.5 bg-[#EAE7DC] rounded-sm w-3/4" />
                  <div className="h-3 bg-[#EAE7DC] rounded-sm w-full" />
                  <div className="h-3 bg-[#EAE7DC] rounded-sm w-5/6" />
                  <div className="h-8 bg-[#EAE7DC] rounded-sm w-1/2 mt-2" />
                </div>
              ) : aiRecommendation ? (
                aiRecommendation.available ? (
                  <div className="space-y-4">
                    {/* 01. Incident analysis */}
                    <section aria-label="Incident analysis" className="space-y-1.5">
                      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] font-semibold text-[#9B4A27]">
                        01. Incident analysis
                      </h3>
                      <p className="text-[#252923] leading-relaxed">
                        {aiRecommendation.disruptionSummary}
                      </p>
                      <p className="text-[#5A5D54] leading-relaxed">
                        {aiRecommendation.rotationPropagationExplanation}
                      </p>
                    </section>

                    {/* 02. Recommended recovery action */}
                    <section
                      aria-label="Recommended recovery action"
                      className="pt-3 border-t border-[#DAD8CE]/80 space-y-2"
                    >
                      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] font-semibold text-[#9B4A27]">
                        02. Recommended recovery action
                      </h3>
                      {aiRecommendation.validatedFeasible && aiRecommendation.recommendedCandidateId ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-sm bg-[#65866B]/12 border border-[#65866B]/40">
                          <div className="flex items-center gap-2 text-[#2F4733]">
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#4A6A50]" aria-hidden="true" />
                            <span className="font-mono font-semibold">
                              {aiRecommendation.recommendedCandidateId}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectCandidate(aiRecommendation.recommendedCandidateId!)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm bg-[#4A6A50] hover:bg-[#3B5740] text-[#FFFEFA] font-medium transition-colors cursor-pointer"
                          >
                            {selectedCandidate?.id === aiRecommendation.recommendedCandidateId ? (
                              <>
                                <Check className="w-3 h-3" aria-hidden="true" />
                                Applied
                              </>
                            ) : (
                              'Apply Selection'
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 p-2.5 rounded-sm bg-[#D69A32]/15 border border-[#D69A32]/45 text-[#6E4909]">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{aiRecommendation.validationMessage}</span>
                        </div>
                      )}
                    </section>

                    {/* 03. Operational reasoning */}
                    <section
                      aria-label="Operational reasoning"
                      className="pt-3 border-t border-[#DAD8CE]/80 space-y-1.5"
                    >
                      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] font-semibold text-[#9B4A27]">
                        03. Operational reasoning
                      </h3>
                      <p className="text-[#252923] leading-relaxed">
                        {aiRecommendation.recommendationRationale}
                      </p>
                    </section>

                    {/* 04. Trade-offs and remaining issues */}
                    <section
                      aria-label="Trade-offs and remaining issues"
                      className="pt-3 border-t border-[#DAD8CE]/80 space-y-1.5"
                    >
                      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] font-semibold text-[#9B4A27]">
                        04. Trade-offs and remaining issues
                      </h3>
                      <p className="text-[#252923] leading-relaxed">
                        {aiRecommendation.passengerAndCrewConsequences}
                      </p>
                      <p className="text-[#5A5D54] leading-relaxed">
                        {aiRecommendation.tradeOffs}
                      </p>
                    </section>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 p-3 rounded-sm bg-[#D69A32]/14 border border-[#D69A32]/45 text-[#6E4909]">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="font-semibold">AI Dispatcher Unavailable</div>
                      <div className="mt-0.5 text-[#7B520B]">{aiRecommendation.error}</div>
                    </div>
                  </div>
                )
              ) : (
                <p className="text-[#5F6259] leading-relaxed">
                  Click &ldquo;Analyze Disruption&rdquo; to generate a qualitative operational
                  briefing and candidate selection from Gemini. All numerical metrics in the ranking
                  and comparison tables come directly from the deterministic simulation engine.
                </p>
              )}
            </div>
          </div>

          {/* Before / After Comparison */}
          <div className="bg-[#FFFEFA] border border-[#DAD8CE] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#DAD8CE]">
              <h2 className="text-base font-semibold text-[#252923] tracking-tight">
                Before / After Recovery Comparison
              </h2>
              <p className="text-xs text-[#5F6259] mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[#9B4A27] font-medium">Original Disruption</span>
                <ArrowRight className="w-3 h-3 text-[#73766D]" aria-hidden="true" />
                <span className="text-[#3B5740] font-semibold">
                  {selectedCandidate?.label ?? 'Do nothing'}
                </span>
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DAD8CE] text-[11px] uppercase tracking-[0.06em] text-[#5A5D54] bg-[#EFECE3]">
                    <th className="py-2 px-3 font-semibold">Metric</th>
                    <th className="py-2 px-3 font-semibold text-right text-[#9B4A27]">Before</th>
                    <th className="py-2 px-3 font-semibold text-right text-[#3B5740]">After</th>
                    <th className="py-2 px-3 font-semibold text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DAD8CE]/75">
                  {comparisonRows.map((row) => {
                    const delta = row.after - row.before;
                    const deltaTone =
                      delta < 0
                        ? 'text-[#3B5740] font-semibold'
                        : delta > 0
                          ? 'text-[#B84239] font-semibold'
                          : 'text-[#73766D]';
                    const deltaText =
                      delta === 0
                        ? '0'
                        : `${delta > 0 ? '+' : ''}${delta.toLocaleString()}${row.unit}`;

                    return (
                      <tr key={row.label} className="hover:bg-[#F7F5EE] transition-colors">
                        <td className="py-2 px-3 text-[#252923]">{row.label}</td>
                        <td className="py-2 px-3 font-mono tabular-nums text-right text-[#9B4A27]">
                          {row.before.toLocaleString()}
                          {row.unit}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-right text-[#252923] font-medium">
                          {row.after.toLocaleString()}
                          {row.unit}
                        </td>
                        <td className={`py-2 px-3 font-mono tabular-nums text-right ${deltaTone}`}>
                          {deltaText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
