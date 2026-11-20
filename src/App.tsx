import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { CascadeTimeline } from './components/CascadeTimeline';
import { FlightImpactTable } from './components/FlightImpactTable';
import { ImpactDetailsPanel } from './components/ImpactDetailsPanel';
import { KpiStrip } from './components/KpiStrip';
import { NetworkMapSvg } from './components/NetworkMapSvg';
import { RecoveryAndAiPanel } from './components/RecoveryAndAiPanel';
import { validateFlightNetworkDataset } from './engine/dataset';
import { evaluateRecoveryOptions } from './engine/recovery';
import { runSimulation } from './engine/simulator';
import { formatMinutes, parseHHMM } from './engine/time';
import type {
  AIDispatchRecommendation,
  AirportClosure,
  FlightNetworkDataset,
} from './engine/types';

type ViewLens = 'ORIGINAL' | 'RECOVERY';

const DATASET_URL = '/assets/aistudio/flight_network_78529dd1.json';

export default function App() {
  const [dataset, setDataset] = useState<FlightNetworkDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form controls
  const [selectedAirport, setSelectedAirport] = useState<string>('AMD');
  const [closureStartStr, setClosureStartStr] = useState<string>('06:20');
  const [durationMinutes, setDurationMinutes] = useState<number>(70);
  const [formError, setFormError] = useState<string | null>(null);

  // Active simulated closure (null = baseline normal schedule)
  const [activeClosure, setActiveClosure] = useState<AirportClosure | null>(null);

  // Recovery selection & view lens
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('DO_NOTHING');
  const [viewLens, setViewLens] = useState<ViewLens>('ORIGINAL');
  const [highlightedFlightId, setHighlightedFlightId] = useState<string | null>(null);

  // AI Dispatcher state
  const [aiRecommendation, setAiRecommendation] = useState<AIDispatchRecommendation | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      aiAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(DATASET_URL);
        if (!res.ok) {
          throw new Error(`Failed to fetch dataset (${res.status})`);
        }
        const json = await res.json();
        const validated = validateFlightNetworkDataset(json);
        if (!cancelled) {
          setDataset(validated);
          setLoadError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Unable to load and validate flight network JSON.'
          );
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const originalSimulation = useMemo(() => {
    if (!dataset) return null;
    return runSimulation(dataset, activeClosure);
  }, [dataset, activeClosure]);

  const recoveryEvaluation = useMemo(() => {
    if (!dataset || !originalSimulation) return null;
    return evaluateRecoveryOptions(dataset, activeClosure, originalSimulation);
  }, [dataset, activeClosure, originalSimulation]);

  // Auto-select top ranked feasible candidate whenever scenario evaluation changes
  useEffect(() => {
    if (!recoveryEvaluation) return;
    const top = recoveryEvaluation.rankedFeasible[0];
    setSelectedCandidateId(top ? top.id : 'DO_NOTHING');
  }, [recoveryEvaluation]);

  const selectedCandidate = useMemo(() => {
    if (!recoveryEvaluation) return null;
    return (
      recoveryEvaluation.rankedFeasible.find((c) => c.id === selectedCandidateId) ??
      recoveryEvaluation.rankedFeasible[0] ??
      null
    );
  }, [recoveryEvaluation, selectedCandidateId]);

  const activeDisplaySimulation = useMemo(() => {
    if (!originalSimulation) return null;
    if (viewLens === 'RECOVERY' && selectedCandidate?.simulation) {
      return selectedCandidate.simulation;
    }
    return originalSimulation;
  }, [originalSimulation, viewLens, selectedCandidate]);

  const executeScenario = useCallback(
    (airport: string, startStr: string, duration: number) => {
      try {
        const startMins = parseHHMM(startStr);
        if (!Number.isFinite(duration) || duration < 5 || duration > 720) {
          setFormError('Closure duration must be between 5 and 720 minutes.');
          return;
        }
        aiAbortRef.current?.abort();
        setAiLoading(false);
        setFormError(null);
        setSelectedAirport(airport);
        setClosureStartStr(startStr);
        setDurationMinutes(duration);
        setActiveClosure({
          airport,
          startMinutes: startMins,
          durationMinutes: Math.round(duration),
        });
        setAiRecommendation(null);
        setViewLens('ORIGINAL');
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Invalid closure parameters.');
      }
    },
    []
  );

  const handleRunSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    executeScenario(selectedAirport, closureStartStr, durationMinutes);
  };

  const handleReset = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiLoading(false);
    setActiveClosure(null);
    setFormError(null);
    setSelectedCandidateId('DO_NOTHING');
    setViewLens('ORIGINAL');
    setHighlightedFlightId(null);
    setAiRecommendation(null);
  }, []);

  const handleSelectCandidate = useCallback((candidateId: string) => {
    setSelectedCandidateId(candidateId);
    if (candidateId !== 'DO_NOTHING') {
      setViewLens('RECOVERY');
    } else {
      setViewLens('ORIGINAL');
    }
  }, []);

  const handleInspectFlight = useCallback((fid: string) => {
    setHighlightedFlightId(fid);
    document.getElementById('flights')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleRequestAiDispatch = useCallback(async () => {
    if (!dataset || !originalSimulation || !recoveryEvaluation || !activeClosure) return;

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiLoading(true);
    setAiRecommendation(null);

    try {
      const airportObj = dataset.airports.find((a) => a.id === activeClosure.airport);
      const payload = {
        scenario: {
          airport: activeClosure.airport,
          airportName: airportObj ? `${airportObj.city} (${airportObj.name})` : activeClosure.airport,
          closureStart: formatMinutes(activeClosure.startMinutes),
          closureEnd: formatMinutes(activeClosure.startMinutes + activeClosure.durationMinutes),
          durationMinutes: activeClosure.durationMinutes,
        },
        baselineMetrics: originalSimulation.summary,
        affectedFlights: originalSimulation.flights
          .filter((f) => f.status !== 'ON_TIME')
          .map((f) => ({
            flightId: f.flightId,
            tailId: f.originalTailId,
            origin: f.origin,
            destination: f.destination,
            delayMinutes: f.delayMinutes,
            status: f.status,
            explanation: f.explanation,
          })),
        disruptedConnections: originalSimulation.connections
          .filter((c) => c.disrupted)
          .map((c) => ({
            connectionId: c.connectionId,
            airport: c.airport,
            fromFlightId: c.fromFlightId,
            toFlightId: c.toFlightId,
            passengers: c.passengers,
            explanation: c.explanation,
          })),
        crewIssues: originalSimulation.crews.map((cr) => ({
          crewId: cr.crewId,
          tailId: cr.tailId,
          dutyMinutes: cr.dutyMinutes,
          maxDutyMinutes: cr.maxDutyMinutes,
          overageMinutes: cr.overageMinutes,
          violation: cr.violation,
        })),
        candidates: recoveryEvaluation.rankedFeasible.map((c) => ({
          id: c.id,
          label: c.label,
          actionType: c.action.type,
          feasible: c.feasible,
          infeasibilityReason: c.infeasibilityReason,
          rank: c.rank,
          improvesOverBaseline: c.improvesOverBaseline,
          metrics: c.metrics,
        })),
      };

      const res = await fetch('/api/ai-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Unexpected server response (${res.status}).`);
      }

      const data = (await res.json()) as AIDispatchRecommendation;
      if (!controller.signal.aborted) {
        setAiRecommendation(data);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!controller.signal.aborted) {
        setAiRecommendation({
          available: false,
          recommendedCandidateId: null,
          disruptionSummary: '',
          rotationPropagationExplanation: '',
          passengerAndCrewConsequences: '',
          recommendationRationale: '',
          tradeOffs: '',
          validatedFeasible: false,
          validationMessage: null,
          error:
            err instanceof Error
              ? `Failed to contact AI dispatcher: ${err.message}`
              : 'Failed to contact AI dispatcher.',
        });
      }
    } finally {
      if (!controller.signal.aborted) {
        setAiLoading(false);
      }
    }
  }, [dataset, originalSimulation, recoveryEvaluation, activeClosure]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#F2F0E8] text-[#252923] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#FFFEFA] border border-[#B84239] rounded-md p-6 space-y-2">
          <h1 className="text-lg font-semibold text-[#B84239]">Dataset Validation Error</h1>
          <p className="text-sm text-[#252923]">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!dataset || !originalSimulation || !recoveryEvaluation || !activeDisplaySimulation) {
    return (
      <div className="min-h-screen bg-[#F2F0E8] text-[#252923] p-6 max-w-[1440px] mx-auto space-y-6">
        <div className="h-14 bg-[#FFFEFA] border border-[#DAD8CE] rounded-md animate-pulse" />
        <div className="h-28 bg-[#FFFEFA] border border-[#DAD8CE] rounded-md animate-pulse" />
        <div className="h-96 bg-[#FFFEFA] border border-[#DAD8CE] rounded-md animate-pulse" />
      </div>
    );
  }

  const closedAirportInfo = activeClosure
    ? dataset.airports.find((a) => a.id === activeClosure.airport)
    : null;

  const statusText = activeClosure
    ? `Active Disruption: ${activeClosure.airport} (${closedAirportInfo?.city ?? ''}) closed ${formatMinutes(activeClosure.startMinutes)}–${formatMinutes(activeClosure.startMinutes + activeClosure.durationMinutes)} IST (${activeClosure.durationMinutes}m)`
    : 'Baseline Schedule · All 16 airports open · 0 active closures';

  const headerModeLabel = activeClosure
    ? `DISRUPTION · ${activeClosure.airport}`
    : 'BASELINE · NOMINAL';

  return (
    <div className="min-h-screen bg-[#F2F0E8] text-[#252923] flex flex-col">
      {/* Compact Editorial Operations Header */}
      <header className="sticky top-0 z-30 bg-[#FFFEFA]/95 backdrop-blur border-b border-[#DAD8CE]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-6">
          <a
            href="#top"
            className="flex flex-col leading-none whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C76B43] rounded-sm"
          >
            <span className="text-[17px] font-bold tracking-[0.04em] text-[#252923] font-display">
              DOMINO SKY
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#73766D] mt-1">
              AIRLINE OPERATIONS INTELLIGENCE
            </span>
          </a>

          <nav
            aria-label="Dashboard sections"
            className="hidden md:flex items-center gap-6 text-xs font-semibold uppercase tracking-[0.08em] text-[#5A5D54]"
          >
            <a
              href="#network"
              className="hover:text-[#9B4A27] transition-colors whitespace-nowrap shrink-0"
            >
              Network
            </a>
            <a
              href="#recovery"
              className="hover:text-[#9B4A27] transition-colors whitespace-nowrap shrink-0"
            >
              Recovery &amp; AI
            </a>
            <a
              href="#timeline"
              className="hover:text-[#9B4A27] transition-colors whitespace-nowrap shrink-0"
            >
              Timeline
            </a>
            <a
              href="#flights"
              className="hover:text-[#9B4A27] transition-colors whitespace-nowrap shrink-0"
            >
              Flights
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 pr-3 border-r border-[#DAD8CE] text-[11px] font-mono uppercase tracking-[0.08em]">
              <span
                className={`w-2 h-2 rounded-full ${
                  activeClosure ? 'bg-[#C76B43]' : 'bg-[#65866B]'
                }`}
                aria-hidden="true"
              />
              <span className={activeClosure ? 'text-[#9B4A27] font-semibold' : 'text-[#3B5740] font-medium'}>
                {headerModeLabel}
              </span>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#252923] bg-[#F5F2EA] hover:bg-[#EAE7DC] border border-[#DAD8CE] rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C76B43]"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#5A5D54]" aria-hidden="true" />
              Reset Scenario
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Operational Incident Configuration Panel */}
        <section
          aria-label="Scenario Controls"
          className="bg-[#FFFEFA] border border-[#DAD8CE] rounded-md p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-[0.14em] font-semibold text-[#9B4A27]">
                Operational Incident Configuration
              </div>
              <h1 className="text-xl sm:text-2xl font-semibold text-[#252923] tracking-tight mt-0.5">
                Flight Disruption Cascade &amp; Recovery Simulator
              </h1>
              <p className="text-xs sm:text-sm text-[#5F6259] mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={
                    activeClosure ? 'text-[#9B4A27] font-semibold' : 'text-[#3B5740] font-medium'
                  }
                >
                  {statusText}
                </span>
                <span className="text-[#BDB9AC]">·</span>
                <span className="font-mono text-xs text-[#5A5D54]">
                  70 flights · 16 aircraft · 2 spares (VT-DS17 BLR, VT-DS18 DEL)
                </span>
              </p>
            </div>

            {/* Demonstration Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[#5F6259] mr-1">
                Presets:
              </span>
              <button
                type="button"
                onClick={() => executeScenario('AMD', '06:20', 70)}
                className="px-3 py-1.5 text-xs font-mono font-medium rounded-sm border border-[#DAD8CE] bg-[#F7F5EE] hover:border-[#C76B43] hover:text-[#9B4A27] text-[#252923] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Preset A: AMD 06:20–07:30
              </button>
              <button
                type="button"
                onClick={() => executeScenario('LKO', '12:30', 60)}
                className="px-3 py-1.5 text-xs font-mono font-medium rounded-sm border border-[#DAD8CE] bg-[#F7F5EE] hover:border-[#C76B43] hover:text-[#9B4A27] text-[#252923] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Preset B: LKO 12:30–13:30
              </button>
            </div>
          </div>

          <form
            onSubmit={handleRunSimulation}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 pt-3.5 border-t border-[#DAD8CE] items-end"
          >
            <div className="lg:col-span-5">
              <label
                htmlFor="airport-select"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5D54] mb-1.5"
              >
                Closed Airport (IST Local Operating Day)
              </label>
              <select
                id="airport-select"
                value={selectedAirport}
                onChange={(e) => setSelectedAirport(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F7F5EE] border border-[#DAD8CE] rounded-sm text-[#252923] focus:outline-none focus:border-[#C76B43]"
              >
                {dataset.airports.map((ap) => (
                  <option key={ap.id} value={ap.id}>
                    {ap.id} — {ap.city} ({ap.name})
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor="closure-start"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5D54] mb-1.5"
              >
                Closure Start (IST)
              </label>
              <input
                id="closure-start"
                type="time"
                value={closureStartStr}
                onChange={(e) => setClosureStartStr(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm font-mono bg-[#F7F5EE] border border-[#DAD8CE] rounded-sm text-[#252923] focus:outline-none focus:border-[#C76B43]"
              />
            </div>

            <div className="lg:col-span-3">
              <label
                htmlFor="closure-duration"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5D54] mb-1.5"
              >
                Duration (Minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="closure-duration"
                  type="number"
                  min={5}
                  max={720}
                  step={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#F7F5EE] border border-[#DAD8CE] rounded-sm text-[#252923] focus:outline-none focus:border-[#C76B43]"
                />
                <div
                  className="hidden sm:flex items-center gap-1"
                  role="group"
                  aria-label="Quick duration presets"
                >
                  {[30, 60, 120].map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={durationMinutes === d}
                      onClick={() => setDurationMinutes(d)}
                      className={`px-2 py-2 text-xs font-mono rounded-sm border transition-colors cursor-pointer ${
                        durationMinutes === d
                          ? 'bg-[#C76B43]/15 border-[#C76B43] text-[#8F3F1D] font-semibold'
                          : 'bg-[#F7F5EE] border-[#DAD8CE] text-[#5A5D54] hover:text-[#252923]'
                      }`}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-sm bg-[#B1552F] hover:bg-[#9A4624] text-[#FFFEFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C76B43]"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                Run Simulation
              </button>
            </div>
          </form>

          {formError && (
            <p role="alert" className="text-xs text-[#B84239] font-medium">
              {formError}
            </p>
          )}
        </section>

        {/* View Lens Switcher when a recovery action is selected */}
        {activeClosure && selectedCandidate && selectedCandidate.id !== 'DO_NOTHING' && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#FFFEFA] border border-[#65866B]/60 rounded-md text-xs">
            <div className="text-[#252923]">
              Comparing recovery:{' '}
              <span className="font-semibold text-[#3B5740]">{selectedCandidate.label}</span>
            </div>
            <div
              role="group"
              aria-label="Compare disruption and recovery views"
              className="flex items-center gap-1 p-1 bg-[#F2F0E8] rounded border border-[#DAD8CE]"
            >
              <button
                type="button"
                aria-pressed={viewLens === 'ORIGINAL'}
                onClick={() => setViewLens('ORIGINAL')}
                className={`px-3 py-1 rounded-sm font-medium transition-colors cursor-pointer ${
                  viewLens === 'ORIGINAL'
                    ? 'bg-[#B1552F] text-[#FFFEFA]'
                    : 'text-[#5A5D54] hover:text-[#252923]'
                }`}
              >
                Original Disruption
              </button>
              <button
                type="button"
                aria-pressed={viewLens === 'RECOVERY'}
                onClick={() => setViewLens('RECOVERY')}
                className={`px-3 py-1 rounded-sm font-medium transition-colors cursor-pointer ${
                  viewLens === 'RECOVERY'
                    ? 'bg-[#4A6A50] text-[#FFFEFA]'
                    : 'text-[#5A5D54] hover:text-[#252923]'
                }`}
              >
                With Selected Recovery
              </button>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <KpiStrip
          metrics={activeDisplaySimulation.summary}
          activeLabel={viewLens === 'RECOVERY' ? 'Recovery KPIs' : 'Original Disruption KPIs'}
        />

        {/* Network Map + Impact Details (Connections, Crew Duty, Passenger Lenses) */}
        <section
          id="network"
          aria-label="Network Map and Operational Impact"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
        >
          <div className="lg:col-span-7">
            <NetworkMapSvg
              airports={dataset.airports}
              flights={activeDisplaySimulation.flights}
              closure={activeDisplaySimulation.closure}
              selectedAirportId={selectedAirport}
              onSelectAirport={setSelectedAirport}
              titleSuffix={
                viewLens === 'RECOVERY' && selectedCandidate?.id !== 'DO_NOTHING'
                  ? 'Recovery View'
                  : activeClosure
                    ? 'Disruption View'
                    : 'Baseline'
              }
            />
          </div>
          <div className="lg:col-span-5">
            <ImpactDetailsPanel simulation={activeDisplaySimulation} />
          </div>
        </section>

        {/* Recovery Engine + AI Dispatcher + Before/After Comparison */}
        <RecoveryAndAiPanel
          originalSimulation={originalSimulation}
          rankedFeasible={recoveryEvaluation.rankedFeasible}
          infeasible={recoveryEvaluation.infeasible}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={handleSelectCandidate}
          aiRecommendation={aiRecommendation}
          aiLoading={aiLoading}
          onRequestAiDispatch={handleRequestAiDispatch}
        />

        {/* Cascade Timeline */}
        <CascadeTimeline
          flights={activeDisplaySimulation.flights}
          closure={activeDisplaySimulation.closure}
          onInspectFlight={handleInspectFlight}
        />

        {/* Flight Impact Table */}
        <FlightImpactTable
          flights={activeDisplaySimulation.flights}
          highlightedFlightId={highlightedFlightId}
        />
      </main>

      {/* Footer with Hackathon Disclosure & Gemini Privacy Notice */}
      <footer className="border-t border-[#DAD8CE] bg-[#EAE7DC]/75 mt-10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#5A5D54]">
          <div className="flex items-start gap-2.5 max-w-2xl">
            <ShieldCheck className="w-4 h-4 text-[#9B4A27] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">
              <strong className="text-[#252923] font-semibold">Hackathon Simulation Notice:</strong>{' '}
              DOMINO SKY is a deterministic operations simulation prototype using the supplied
              70-flight IST network dataset. Model assumptions (single airport closure per scenario,
              half-open [start, end) closure intervals, fixed block times, and zero additional
              aircraft-switch time for spare substitutions) are simplified for demonstration and
              do not constitute a certified real-world airline dispatch system.
            </p>
          </div>
          <p className="max-w-md text-[#5A5D54] leading-relaxed">
            <strong className="text-[#252923] font-semibold">AI Data Notice:</strong> When AI
            Dispatcher analysis is requested, only computed scenario metrics and candidate summaries
            are sent to the server-side Gemini API. No personal passenger or user data is collected.
          </p>
        </div>
      </footer>
    </div>
  );
}
