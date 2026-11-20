import { formatMinutes, parseHHMM } from './time';
import type {
  AircraftFinalState,
  AirportClosure,
  ConnectionSimulationResult,
  CrewSimulationResult,
  DelayCauseType,
  FlightNetworkDataset,
  FlightRecord,
  FlightSimulationResult,
  PassengerImpactMetrics,
  SimulationResult,
  SimulationSummaryMetrics,
} from './types';

export interface SimulationOverrides {
  cancelledFlightIds?: Set<string>;
  spareSubstitution?: {
    spareTailId: string;
    flightId: string;
  } | null;
}

export function runSimulation(
  dataset: FlightNetworkDataset,
  closureInput: AirportClosure | null,
  overrides?: SimulationOverrides
): SimulationResult {
  const activeClosure =
    closureInput && closureInput.durationMinutes > 0 && closureInput.airport
      ? {
          airport: closureInput.airport,
          startMinutes: closureInput.startMinutes,
          durationMinutes: closureInput.durationMinutes,
        }
      : null;

  const closureEnd = activeClosure
    ? activeClosure.startMinutes + activeClosure.durationMinutes
    : null;

  const globalMinTurn = dataset.meta.min_turnaround_minutes;
  const cancelledSet = overrides?.cancelledFlightIds ?? new Set<string>();
  const spareSub = overrides?.spareSubstitution ?? null;

  // Group flights by tail_id sorted by leg_order
  const flightsByTail = new Map<string, FlightRecord[]>();
  for (const f of dataset.flights) {
    const arr = flightsByTail.get(f.tail_id) ?? [];
    arr.push(f);
    flightsByTail.set(f.tail_id, arr);
  }
  for (const [tail, list] of flightsByTail.entries()) {
    list.sort((a, b) => a.leg_order - b.leg_order);
    flightsByTail.set(tail, list);
  }

  // Crew lookup by tail
  const crewByTail = new Map(dataset.crews.map((c) => [c.tail_id, c]));
  // Spare lookup
  const spareMap = new Map(dataset.spare_aircraft.map((s) => [s.tail_id, s]));

  const flightResults: FlightSimulationResult[] = [];
  const aircraftStates: AircraftFinalState[] = [];

  for (const [tailId, rotation] of flightsByTail.entries()) {
    const crew = crewByTail.get(tailId);
    const subIndex =
      spareSub && rotation.some((r) => r.flight_id === spareSub.flightId)
        ? rotation.findIndex((r) => r.flight_id === spareSub.flightId)
        : -1;
    const spareRecord = subIndex >= 0 && spareSub ? spareMap.get(spareSub.spareTailId) ?? null : null;

    // Physical state for primary tail
    let primaryAirport = rotation[0].origin;
    let primaryAvailableTime: number | null = null;
    let primaryLastOperatedArr: number | null = null;
    let primaryLastOperatedFlightId: string | null = null;
    let primaryHadInterveningCancellation = false;
    const primaryOperatedIds: string[] = [];
    const primaryCancelledIds: string[] = [];

    // Physical state for spare tail (if substituted on this rotation)
    let spareAirport = spareRecord ? spareRecord.base : '';
    let spareAvailableTime: number | null = spareRecord ? parseHHMM(spareRecord.available_from) : null;
    let spareLastOperatedArr: number | null = null;
    let spareLastOperatedFlightId: string | null = null;
    let spareHadInterveningCancellation = false;
    const spareAssignedIds: string[] = [];
    const spareOperatedIds: string[] = [];
    const spareCancelledIds: string[] = [];

    for (let idx = 0; idx < rotation.length; idx++) {
      const f = rotation[idx];
      const scheduledDep = parseHHMM(f.dep);
      const scheduledArr = parseHHMM(f.arr);

      const usingSpare = Boolean(spareRecord && idx >= subIndex);
      const isFirstSpareLeg = Boolean(spareRecord && idx === subIndex);
      const operatingTailId = usingSpare && spareRecord ? spareRecord.tail_id : tailId;

      if (usingSpare) {
        spareAssignedIds.push(f.flight_id);
      }

      const currentAirport = usingSpare ? spareAirport : primaryAirport;
      const prevAvailableTime = usingSpare ? spareAvailableTime : primaryAvailableTime;
      const prevOperatedArr = usingSpare ? spareLastOperatedArr : primaryLastOperatedArr;
      const prevOperatedFlightId = usingSpare
        ? spareLastOperatedFlightId
        : primaryLastOperatedFlightId;
      const hadInterveningCancellation = usingSpare
        ? spareHadInterveningCancellation
        : primaryHadInterveningCancellation;

      // Determine actual applied turnaround from physical aircraft state:
      // - No prior operated flight on this aircraft: 0 (do not invent a previous arrival/turnaround)
      // - Resuming after one or more intervening cancellations: global minimum turnaround (30m)
      // - Immediately preceding assigned flight operated normally: flight-specific turnaround requirement
      let appliedTurnaround = 0;
      if (isFirstSpareLeg) {
        appliedTurnaround = 0;
      } else if (prevOperatedArr !== null) {
        appliedTurnaround = hadInterveningCancellation
          ? globalMinTurn
          : Math.max(globalMinTurn, f.turnaround_before_min ?? 0);
      }

      // 1. Explicit cancellation override
      if (cancelledSet.has(f.flight_id)) {
        if (usingSpare) {
          spareCancelledIds.push(f.flight_id);
          spareHadInterveningCancellation = true;
        } else {
          primaryCancelledIds.push(f.flight_id);
          primaryHadInterveningCancellation = true;
        }
        flightResults.push({
          flightId: f.flight_id,
          originalTailId: tailId,
          operatingTailId,
          substitutedBySpare: usingSpare,
          legOrder: f.leg_order,
          origin: f.origin,
          destination: f.destination,
          pax: f.pax,
          blockMinutes: f.block_minutes,
          requiredTurnaroundMinutes: appliedTurnaround,
          scheduledDep,
          scheduledArr,
          actualDep: null,
          actualArr: null,
          delayMinutes: 0,
          status: 'CANCELLED',
          causeType: 'CANCELLED_ACTION',
          propagatedFromFlightId: null,
          explanation: `Cancelled by recovery action; ${operatingTailId} remains positioned at ${currentAirport}.`,
        });
        continue;
      }

      // 2. Aircraft physical positioning check (never teleport!)
      if (currentAirport !== f.origin) {
        if (usingSpare) {
          spareCancelledIds.push(f.flight_id);
          spareHadInterveningCancellation = true;
        } else {
          primaryCancelledIds.push(f.flight_id);
          primaryHadInterveningCancellation = true;
        }
        flightResults.push({
          flightId: f.flight_id,
          originalTailId: tailId,
          operatingTailId,
          substitutedBySpare: usingSpare,
          legOrder: f.leg_order,
          origin: f.origin,
          destination: f.destination,
          pax: f.pax,
          blockMinutes: f.block_minutes,
          requiredTurnaroundMinutes: appliedTurnaround,
          scheduledDep,
          scheduledArr,
          actualDep: null,
          actualArr: null,
          delayMinutes: 0,
          status: 'CANCELLED',
          causeType: 'CANCELLED_POSITIONING',
          propagatedFromFlightId: null,
          explanation: `Cancelled due to aircraft positioning: ${operatingTailId} is at ${currentAirport}, cannot originate at ${f.origin}.`,
        });
        continue;
      }

      // 3. Earliest departure from physical aircraft availability + turnaround or spare/crew readiness
      let earliestDep = scheduledDep;
      let turnaroundDelayed = false;
      let crewWaitDelayed = false;
      let propagatedFromFlightId: string | null = null;

      if (isFirstSpareLeg && spareRecord) {
        // Spare aircraft starts at base with zero aircraft-switch penalty for MVP,
        // but must respect spare available_from and original crew's arrival at origin.
        const spareReady = spareAvailableTime ?? parseHHMM(spareRecord.available_from);
        const crewReady =
          idx === 0
            ? crew
              ? parseHHMM(crew.duty_start)
              : 0
            : primaryAvailableTime ?? 0;
        const readyTime = Math.max(spareReady, crewReady);
        if (readyTime > scheduledDep) {
          earliestDep = readyTime;
          crewWaitDelayed = true;
          propagatedFromFlightId = primaryLastOperatedFlightId;
        }
      } else if (prevAvailableTime !== null && prevOperatedArr !== null) {
        const readyAfterTurn = prevAvailableTime + appliedTurnaround;
        if (readyAfterTurn > earliestDep) {
          earliestDep = readyAfterTurn;
          turnaroundDelayed = true;
          propagatedFromFlightId = prevOperatedFlightId;
        }
      }

      // 4. Airport closure half-open interval [start, end)
      let dep = earliestDep;
      let arr = dep + f.block_minutes;
      let originClosureDelayed = false;
      let destClosureDelayed = false;

      if (activeClosure && closureEnd !== null) {
        let iterations = 0;
        while (iterations < 12) {
          iterations++;
          let changed = false;

          // Departure exactly at closure_start is prohibited; exactly at closure_end is permitted.
          if (
            f.origin === activeClosure.airport &&
            dep >= activeClosure.startMinutes &&
            dep < closureEnd
          ) {
            dep = closureEnd;
            arr = dep + f.block_minutes;
            originClosureDelayed = true;
            changed = true;
          }

          // Arrival exactly at closure_start is prohibited; exactly at closure_end is permitted.
          if (
            f.destination === activeClosure.airport &&
            arr >= activeClosure.startMinutes &&
            arr < closureEnd
          ) {
            const requiredDepForArrival = closureEnd - f.block_minutes;
            if (requiredDepForArrival > dep) {
              dep = requiredDepForArrival;
              arr = dep + f.block_minutes;
              destClosureDelayed = true;
              changed = true;
            }
          }

          if (!changed) break;
        }
      }

      // 5. Update aircraft physical state
      if (usingSpare) {
        spareAirport = f.destination;
        spareAvailableTime = arr;
        spareLastOperatedArr = arr;
        spareLastOperatedFlightId = f.flight_id;
        spareHadInterveningCancellation = false;
        spareOperatedIds.push(f.flight_id);
      } else {
        primaryAirport = f.destination;
        primaryAvailableTime = arr;
        primaryLastOperatedArr = arr;
        primaryLastOperatedFlightId = f.flight_id;
        primaryHadInterveningCancellation = false;
        primaryOperatedIds.push(f.flight_id);
      }

      const delayMinutes = arr - scheduledArr;
      const status = delayMinutes > 0 ? 'DELAYED' : 'ON_TIME';

      // Build clear causal explanation
      let causeType: DelayCauseType = 'NONE';
      const reasons: string[] = [];

      if (usingSpare) {
        reasons.push(`Operated by spare ${operatingTailId} (substituting for ${tailId})`);
      }

      if (turnaroundDelayed && propagatedFromFlightId) {
        causeType = 'TURNAROUND_PROPAGATION';
        if (hadInterveningCancellation) {
          reasons.push(
            `Resumed rotation at ${f.origin} after intervening cancellation; applied ${appliedTurnaround}m global minimum turnaround from ${propagatedFromFlightId} (arr ${formatMinutes(prevAvailableTime)})`
          );
        } else {
          reasons.push(
            `Inherited ${appliedTurnaround}m turnaround from ${propagatedFromFlightId} (arr ${formatMinutes(prevAvailableTime)})`
          );
        }
      } else if (crewWaitDelayed && propagatedFromFlightId) {
        causeType = 'CREW_POSITIONING_WAIT';
        reasons.push(`Awaiting inbound crew from ${propagatedFromFlightId}`);
      } else if (hadInterveningCancellation) {
        if (prevOperatedFlightId !== null) {
          reasons.push(
            `Resumed rotation at ${f.origin} after intervening cancellation (${appliedTurnaround}m global minimum turnaround applied from ${prevOperatedFlightId})`
          );
        } else {
          reasons.push(
            `Resumed rotation at ${f.origin} after earlier cancellation (no prior operated flight turnaround required)`
          );
        }
      }

      if (originClosureDelayed && activeClosure && closureEnd !== null) {
        if (causeType === 'NONE') causeType = 'ORIGIN_CLOSURE';
        reasons.push(
          `Origin ${f.origin} closed ${formatMinutes(activeClosure.startMinutes)}–${formatMinutes(closureEnd)}`
        );
      }

      if (destClosureDelayed && activeClosure && closureEnd !== null) {
        if (causeType === 'NONE') causeType = 'DESTINATION_CLOSURE';
        reasons.push(
          `Destination ${f.destination} closed ${formatMinutes(activeClosure.startMinutes)}–${formatMinutes(closureEnd)}`
        );
      }

      if (delayMinutes === 0 && reasons.length === 0) {
        reasons.push('Operated on schedule');
      } else if (delayMinutes === 0 && (usingSpare || hadInterveningCancellation)) {
        reasons.push('Operated on schedule');
      }

      flightResults.push({
        flightId: f.flight_id,
        originalTailId: tailId,
        operatingTailId,
        substitutedBySpare: usingSpare,
        legOrder: f.leg_order,
        origin: f.origin,
        destination: f.destination,
        pax: f.pax,
        blockMinutes: f.block_minutes,
        requiredTurnaroundMinutes: appliedTurnaround,
        scheduledDep,
        scheduledArr,
        actualDep: dep,
        actualArr: arr,
        delayMinutes,
        status,
        causeType,
        propagatedFromFlightId,
        explanation: reasons.join('; ') + '.',
      });
    }

    const primaryAssigned = spareRecord
      ? rotation.slice(0, subIndex).map((f) => f.flight_id)
      : rotation.map((f) => f.flight_id);

    aircraftStates.push({
      tailId,
      isSpare: false,
      currentAirport: primaryAirport,
      availableTime: primaryAvailableTime,
      lastOperatedArrival: primaryLastOperatedArr,
      lastOperatedFlightId: primaryLastOperatedFlightId,
      assignedFlightIds: primaryAssigned,
      operatedFlightIds: primaryOperatedIds,
      cancelledFlightIds: primaryCancelledIds,
    });

    if (spareRecord) {
      aircraftStates.push({
        tailId: spareRecord.tail_id,
        isSpare: true,
        currentAirport: spareAirport,
        availableTime: spareAvailableTime,
        lastOperatedArrival: spareLastOperatedArr,
        lastOperatedFlightId: spareLastOperatedFlightId,
        assignedFlightIds: spareAssignedIds,
        operatedFlightIds: spareOperatedIds,
        cancelledFlightIds: spareCancelledIds,
      });
    }
  }

  // Sort flights back into dataset order for deterministic presentation
  const datasetOrder = new Map(dataset.flights.map((f, i) => [f.flight_id, i]));
  flightResults.sort(
    (a, b) => (datasetOrder.get(a.flightId) ?? 0) - (datasetOrder.get(b.flightId) ?? 0)
  );

  const flightsById: Record<string, FlightSimulationResult> = {};
  for (const fr of flightResults) {
    flightsById[fr.flightId] = fr;
  }

  // Evaluate passenger connections (each connection record counted once)
  const connections: ConnectionSimulationResult[] = dataset.connections.map((cx) => {
    const fromF = flightsById[cx.from_flight];
    const toF = flightsById[cx.to_flight];

    if (fromF.status === 'CANCELLED' || toF.status === 'CANCELLED') {
      const which =
        fromF.status === 'CANCELLED' && toF.status === 'CANCELLED'
          ? `Both ${cx.from_flight} and ${cx.to_flight} cancelled`
          : fromF.status === 'CANCELLED'
            ? `Inbound ${cx.from_flight} cancelled`
            : `Outbound ${cx.to_flight} cancelled`;
      return {
        connectionId: cx.connection_id,
        airport: cx.airport,
        fromFlightId: cx.from_flight,
        toFlightId: cx.to_flight,
        passengers: cx.passengers,
        minConnectMinutes: cx.min_connect_minutes,
        fromActualArrival: fromF.actualArr,
        toActualDeparture: toF.actualDep,
        actualConnectMinutes: null,
        status: 'DISRUPTED_CANCELLED',
        disrupted: true,
        explanation: `${which} at ${cx.airport}.`,
      };
    }

    const fromArr = fromF.actualArr!;
    const toDep = toF.actualDep!;
    const actualConnect = toDep - fromArr;
    const missed = fromArr + cx.min_connect_minutes > toDep;

    return {
      connectionId: cx.connection_id,
      airport: cx.airport,
      fromFlightId: cx.from_flight,
      toFlightId: cx.to_flight,
      passengers: cx.passengers,
      minConnectMinutes: cx.min_connect_minutes,
      fromActualArrival: fromArr,
      toActualDeparture: toDep,
      actualConnectMinutes: actualConnect,
      status: missed ? 'MISSED_TIME' : 'MADE',
      disrupted: missed,
      explanation: missed
        ? `Insufficient connect time at ${cx.airport}: ${actualConnect}m available < ${cx.min_connect_minutes}m required.`
        : `Connection made at ${cx.airport} (${actualConnect}m available, ${cx.min_connect_minutes}m required).`,
    };
  });

  // Passenger impact metrics (never summed into unique stranded count)
  let disruptedConnectionPaxEvents = 0;
  let disruptedConnectionsCount = 0;
  for (const cx of connections) {
    if (cx.disrupted) {
      disruptedConnectionPaxEvents += cx.passengers;
      disruptedConnectionsCount++;
    }
  }

  let passengersOnCancelledFlights = 0;
  let passengersOnDelayedOperatedFlights = 0;
  let passengerLegDelayMinutes = 0;
  let delayedFlights = 0;
  let cancelledFlights = 0;
  let onTimeFlights = 0;
  let totalArrivalDelayMinutes = 0;
  let maxFlightDelayMinutes = 0;

  for (const fr of flightResults) {
    if (fr.status === 'CANCELLED') {
      cancelledFlights++;
      passengersOnCancelledFlights += fr.pax;
    } else if (fr.status === 'DELAYED') {
      delayedFlights++;
      totalArrivalDelayMinutes += fr.delayMinutes;
      if (fr.delayMinutes > maxFlightDelayMinutes) {
        maxFlightDelayMinutes = fr.delayMinutes;
      }
      passengersOnDelayedOperatedFlights += fr.pax;
      passengerLegDelayMinutes += fr.pax * fr.delayMinutes;
    } else {
      onTimeFlights++;
    }
  }

  const passengerImpact: PassengerImpactMetrics = {
    disruptedConnectionPaxEvents,
    disruptedConnectionsCount,
    passengersOnCancelledFlights,
    passengersOnDelayedOperatedFlights,
    passengerLegDelayMinutes,
  };

  // Evaluate crew duty
  const crews: CrewSimulationResult[] = dataset.crews.map((cr) => {
    const dutyStartMinutes = parseHHMM(cr.duty_start);
    const operated = cr.flight_ids
      .map((fid) => flightsById[fid])
      .filter((fr) => fr && fr.status !== 'CANCELLED' && fr.actualArr !== null);

    if (operated.length === 0) {
      return {
        crewId: cr.crew_id,
        tailId: cr.tail_id,
        base: cr.base,
        dutyStartMinutes,
        maxDutyMinutes: cr.max_duty_mins,
        assignedFlightIds: cr.flight_ids,
        operatedFlightIds: [],
        lastOperatedFlightId: null,
        lastOperatedArrival: null,
        evaluated: false,
        dutyMinutes: null,
        remainingHeadroomMinutes: null,
        violation: false,
        overageMinutes: 0,
      };
    }

    // Last operated assigned flight (by highest legOrder, or latest arrival)
    const lastFlight = operated.reduce((best, cur) =>
      cur.legOrder > best.legOrder ? cur : best
    );
    const lastArr = lastFlight.actualArr!;
    const dutyMinutes = lastArr - dutyStartMinutes;
    const remainingHeadroomMinutes = cr.max_duty_mins - dutyMinutes;
    const violation = dutyMinutes > cr.max_duty_mins;
    const overageMinutes = Math.max(0, dutyMinutes - cr.max_duty_mins);

    return {
      crewId: cr.crew_id,
      tailId: cr.tail_id,
      base: cr.base,
      dutyStartMinutes,
      maxDutyMinutes: cr.max_duty_mins,
      assignedFlightIds: cr.flight_ids,
      operatedFlightIds: operated.map((o) => o.flightId),
      lastOperatedFlightId: lastFlight.flightId,
      lastOperatedArrival: lastArr,
      evaluated: true,
      dutyMinutes,
      remainingHeadroomMinutes,
      violation,
      overageMinutes,
    };
  });

  let crewDutyViolations = 0;
  let totalCrewDutyOverageMinutes = 0;
  let evaluatedCrews = 0;
  for (const cr of crews) {
    if (cr.evaluated) evaluatedCrews++;
    if (cr.violation) {
      crewDutyViolations++;
      totalCrewDutyOverageMinutes += cr.overageMinutes;
    }
  }

  const summary: SimulationSummaryMetrics = {
    totalFlights: flightResults.length,
    operatedFlights: flightResults.length - cancelledFlights,
    onTimeFlights,
    delayedFlights,
    cancelledFlights,
    totalArrivalDelayMinutes,
    maxFlightDelayMinutes,
    disruptedConnectionPaxEvents,
    disruptedConnectionsCount,
    passengersOnCancelledFlights,
    passengersOnDelayedOperatedFlights,
    passengerLegDelayMinutes,
    crewDutyViolations,
    totalCrewDutyOverageMinutes,
    evaluatedCrews,
  };

  return {
    closure: activeClosure,
    closureEndMinutes: closureEnd,
    flights: flightResults,
    flightsById,
    aircraftStates,
    connections,
    crews,
    passengerImpact,
    summary,
  };
}
