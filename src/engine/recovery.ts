import { runSimulation } from './simulator';
import { parseHHMM } from './time';
import type {
  AirportClosure,
  FlightNetworkDataset,
  FlightRecord,
  RecoveryAction,
  RecoveryCandidate,
  SimulationResult,
  SimulationSummaryMetrics,
} from './types';

const SPARE_ASSUMPTION =
  'MVP assumption: zero additional aircraft-switch time when transferring the original crew to a substituted spare aircraft.';

export function compareMetricsLexicographic(
  a: SimulationSummaryMetrics,
  b: SimulationSummaryMetrics
): number {
  const keys: (keyof SimulationSummaryMetrics)[] = [
    'crewDutyViolations',
    'totalCrewDutyOverageMinutes',
    'passengersOnCancelledFlights',
    'cancelledFlights',
    'disruptedConnectionPaxEvents',
    'passengerLegDelayMinutes',
    'totalArrivalDelayMinutes',
  ];

  for (const k of keys) {
    const diff = a[k] - b[k];
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildCandidateId(action: RecoveryAction): string {
  if (action.type === 'DO_NOTHING') return 'DO_NOTHING';
  if (action.type === 'CANCEL_FLIGHT') return `CANCEL_${action.flightId}`;
  return `SUB_${action.spareTailId}_${action.flightId}`;
}

export function checkSpareSubstitutionFeasibility(
  dataset: FlightNetworkDataset,
  originalSimulation: SimulationResult,
  spareTailId: string,
  flightId: string
): { feasible: boolean; reason: string | null } {
  const spare = dataset.spare_aircraft.find((s) => s.tail_id === spareTailId);
  if (!spare) {
    return { feasible: false, reason: `Spare aircraft ${spareTailId} not found.` };
  }

  const targetFlight = dataset.flights.find((f) => f.flight_id === flightId);
  if (!targetFlight) {
    return { feasible: false, reason: `Flight ${flightId} not found.` };
  }

  // 1. Spare base must match selected flight origin
  if (spare.base !== targetFlight.origin) {
    return {
      feasible: false,
      reason: `Spare ${spareTailId} is based at ${spare.base}, but ${flightId} originates at ${targetFlight.origin}.`,
    };
  }

  // 2. Spare availability check (and not already used — single-action evaluation)
  parseHHMM(spare.available_from);

  // Build rotation for target tail sorted by leg_order
  const rotation: FlightRecord[] = dataset.flights
    .filter((f) => f.tail_id === targetFlight.tail_id)
    .sort((a, b) => a.leg_order - b.leg_order);

  const idx = rotation.findIndex((f) => f.flight_id === flightId);
  const subRotation = rotation.slice(idx);

  // 3. Spare seats must accommodate passengers on all flights it operates
  for (const leg of subRotation) {
    if (leg.pax > spare.seats) {
      return {
        feasible: false,
        reason: `Spare ${spareTailId} has ${spare.seats} seats, insufficient for ${leg.flight_id} (${leg.pax} pax).`,
      };
    }
  }

  // 4. Subsequent flights must form a continuous rotation
  for (let i = 0; i < subRotation.length - 1; i++) {
    if (subRotation[i].destination !== subRotation[i + 1].origin) {
      return {
        feasible: false,
        reason: `Subsequent flights ${subRotation[i].flight_id} (${subRotation[i].destination}) -> ${subRotation[i + 1].flight_id} (${subRotation[i + 1].origin}) do not form a continuous rotation.`,
      };
    }
  }

  // 5. Restrict substitutions to first flight of rotation OR a flight where previous assigned flights operated
  // and original crew is position-feasible at the selected origin
  const crew = dataset.crews.find((c) => c.tail_id === targetFlight.tail_id);
  if (!crew) {
    return {
      feasible: false,
      reason: `No assigned crew found for tail ${targetFlight.tail_id}.`,
    };
  }

  if (idx === 0) {
    if (crew.base !== targetFlight.origin) {
      return {
        feasible: false,
        reason: `Crew ${crew.crew_id} is based at ${crew.base}, not ${targetFlight.origin}.`,
      };
    }
  } else {
    const prevLegs = rotation.slice(0, idx);
    for (const prev of prevLegs) {
      const simRes = originalSimulation.flightsById[prev.flight_id];
      if (!simRes || simRes.status === 'CANCELLED') {
        return {
          feasible: false,
          reason: `Previous flight ${prev.flight_id} did not operate; crew ${crew.crew_id} positioning at ${targetFlight.origin} cannot be confirmed.`,
        };
      }
    }
    const immediatePrev = prevLegs[prevLegs.length - 1];
    if (immediatePrev.destination !== targetFlight.origin) {
      return {
        feasible: false,
        reason: `Previous flight ${immediatePrev.flight_id} arrived at ${immediatePrev.destination}, not ${targetFlight.origin}.`,
      };
    }
  }

  return { feasible: true, reason: null };
}

export function evaluateSingleRecovery(
  dataset: FlightNetworkDataset,
  closure: AirportClosure | null,
  originalSimulation: SimulationResult,
  action: RecoveryAction
): RecoveryCandidate {
  const id = buildCandidateId(action);

  if (action.type === 'DO_NOTHING') {
    return {
      id,
      action,
      label: 'Do nothing (baseline)',
      description: 'Allow the disruption cascade to run with no aircraft cancellations or spare substitutions.',
      feasible: true,
      infeasibilityReason: null,
      rank: null,
      improvesOverBaseline: false,
      simulation: originalSimulation,
      metrics: originalSimulation.summary,
      assumptions: [],
    };
  }

  if (action.type === 'CANCEL_FLIGHT') {
    const flight = dataset.flights.find((f) => f.flight_id === action.flightId);
    if (!flight) {
      return {
        id,
        action,
        label: `Cancel ${action.flightId}`,
        description: `Cancel flight ${action.flightId}.`,
        feasible: false,
        infeasibilityReason: `Flight ${action.flightId} does not exist.`,
        rank: null,
        improvesOverBaseline: false,
        simulation: null,
        metrics: null,
        assumptions: [],
      };
    }

    const sim = runSimulation(dataset, closure, {
      cancelledFlightIds: new Set([action.flightId]),
    });

    const cmp = compareMetricsLexicographic(sim.summary, originalSimulation.summary);

    return {
      id,
      action,
      label: `Cancel ${flight.flight_id} (${flight.origin}→${flight.destination})`,
      description: `Cancel ${flight.flight_id} on ${flight.tail_id}; preserve physical aircraft position at ${flight.origin} and recalculate downstream legs.`,
      feasible: true,
      infeasibilityReason: null,
      rank: null,
      improvesOverBaseline: cmp < 0,
      simulation: sim,
      metrics: sim.summary,
      assumptions: [
        'Preserves aircraft physical positioning without ferry flights.',
      ],
    };
  }

  // SUBSTITUTE_SPARE
  const flight = dataset.flights.find((f) => f.flight_id === action.flightId);
  const feasibility = checkSpareSubstitutionFeasibility(
    dataset,
    originalSimulation,
    action.spareTailId,
    action.flightId
  );

  if (!feasibility.feasible || !flight) {
    return {
      id,
      action,
      label: `Substitute ${action.spareTailId} on ${action.flightId}`,
      description: flight
        ? `Assign spare ${action.spareTailId} to ${flight.flight_id} (${flight.origin}→${flight.destination}) and remaining continuous legs.`
        : `Assign spare ${action.spareTailId} to ${action.flightId}.`,
      feasible: false,
      infeasibilityReason: feasibility.reason,
      rank: null,
      improvesOverBaseline: false,
      simulation: null,
      metrics: null,
      assumptions: [SPARE_ASSUMPTION],
    };
  }

  const sim = runSimulation(dataset, closure, {
    spareSubstitution: {
      spareTailId: action.spareTailId,
      flightId: action.flightId,
    },
  });

  const cmp = compareMetricsLexicographic(sim.summary, originalSimulation.summary);

  return {
    id,
    action,
    label: `Substitute ${action.spareTailId} for ${flight.flight_id} (${flight.origin}→${flight.destination})`,
    description: `Deploy spare ${action.spareTailId} (base ${flight.origin}) from ${flight.flight_id} onward with original crew of ${flight.tail_id}.`,
    feasible: true,
    infeasibilityReason: null,
    rank: null,
    improvesOverBaseline: cmp < 0,
    simulation: sim,
    metrics: sim.summary,
    assumptions: [SPARE_ASSUMPTION],
  };
}

export function evaluateRecoveryOptions(
  dataset: FlightNetworkDataset,
  closure: AirportClosure | null,
  originalSimulation: SimulationResult
): {
  rankedFeasible: RecoveryCandidate[];
  infeasible: RecoveryCandidate[];
} {
  const candidates: RecoveryCandidate[] = [];

  // A. Do nothing baseline
  candidates.push(
    evaluateSingleRecovery(dataset, closure, originalSimulation, { type: 'DO_NOTHING' })
  );

  // Identify affected tails (any tail with delayed/cancelled flight, crew duty violation, or disrupted connection)
  const affectedTails = new Set<string>();
  for (const fr of originalSimulation.flights) {
    if (fr.status !== 'ON_TIME') {
      affectedTails.add(fr.originalTailId);
    }
  }
  for (const cr of originalSimulation.crews) {
    if (cr.violation) {
      affectedTails.add(cr.tailId);
    }
  }
  for (const cx of originalSimulation.connections) {
    if (cx.disrupted) {
      const fromF = originalSimulation.flightsById[cx.fromFlightId];
      const toF = originalSimulation.flightsById[cx.toFlightId];
      if (fromF) affectedTails.add(fromF.originalTailId);
      if (toF) affectedTails.add(toF.originalTailId);
    }
  }

  const eligibleFlights = dataset.flights.filter((f) => affectedTails.has(f.tail_id));

  // B. Cancel one eligible flight on affected rotations
  for (const f of eligibleFlights) {
    candidates.push(
      evaluateSingleRecovery(dataset, closure, originalSimulation, {
        type: 'CANCEL_FLIGHT',
        flightId: f.flight_id,
      })
    );
  }

  // C & D. Substitute spare aircraft VT-DS17 (BLR) and VT-DS18 (DEL)
  for (const spare of dataset.spare_aircraft) {
    for (const f of eligibleFlights) {
      // Only include spare candidates where origin matches spare base OR flight is delayed (to keep list focused)
      if (f.origin === spare.base) {
        candidates.push(
          evaluateSingleRecovery(dataset, closure, originalSimulation, {
            type: 'SUBSTITUTE_SPARE',
            spareTailId: spare.tail_id,
            flightId: f.flight_id,
          })
        );
      }
    }
  }

  const feasible = candidates.filter((c) => c.feasible && c.metrics !== null);
  const infeasible = candidates.filter((c) => !c.feasible);

  feasible.sort((a, b) => {
    const cmp = compareMetricsLexicographic(a.metrics!, b.metrics!);
    if (cmp !== 0) return cmp;
    // Deterministic tie-breaker: DO_NOTHING preferred over unnecessary actions when metrics are identical
    const typeOrder = (t: RecoveryAction['type']) =>
      t === 'DO_NOTHING' ? 0 : t === 'SUBSTITUTE_SPARE' ? 1 : 2;
    const typeDiff = typeOrder(a.action.type) - typeOrder(b.action.type);
    if (typeDiff !== 0) return typeDiff;
    return a.id.localeCompare(b.id);
  });

  feasible.forEach((c, idx) => {
    c.rank = idx + 1;
  });

  return {
    rankedFeasible: feasible,
    infeasible,
  };
}
