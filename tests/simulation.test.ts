import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateFlightNetworkDataset } from '../src/engine/dataset';
import {
  checkSpareSubstitutionFeasibility,
  evaluateRecoveryOptions,
  evaluateSingleRecovery,
} from '../src/engine/recovery';
import { runSimulation } from '../src/engine/simulator';
import { formatMinutes, parseHHMM } from '../src/engine/time';
import { getClientIp, isRateLimited, validateDispatchPayload } from '../server';

const rawJson = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'public/assets/aistudio/flight_network_78529dd1.json'),
    'utf8'
  )
);
const dataset = validateFlightNetworkDataset(rawJson);

test('1. Normal baseline schedule has zero delays, cancellations, missed connections, and duty violations', () => {
  const sim = runSimulation(dataset, null);
  assert.equal(sim.summary.totalFlights, 70);
  assert.equal(sim.summary.operatedFlights, 70);
  assert.equal(sim.summary.onTimeFlights, 70);
  assert.equal(sim.summary.delayedFlights, 0);
  assert.equal(sim.summary.cancelledFlights, 0);
  assert.equal(sim.summary.totalArrivalDelayMinutes, 0);
  assert.equal(sim.summary.disruptedConnectionsCount, 0);
  assert.equal(sim.summary.disruptedConnectionPaxEvents, 0);
  assert.equal(sim.summary.crewDutyViolations, 0);
  assert.equal(sim.summary.evaluatedCrews, 16);
  assert.equal(dataset.airports.length, 16);
  assert.equal(dataset.connections.length, 21);
  assert.equal(dataset.spare_aircraft.length, 2);
});

test('2. DEL closure 07:30-08:30 delays DS0101 and DS0201 arrival', () => {
  const sim = runSimulation(dataset, {
    airport: 'DEL',
    startMinutes: parseHHMM('07:30'),
    durationMinutes: 60,
  });

  // DS0101 departs DEL at 08:00 -> delayed to 08:30 (+30m)
  const ds0101 = sim.flightsById['DS0101'];
  assert.equal(ds0101.status, 'DELAYED');
  assert.equal(ds0101.actualDep, parseHHMM('08:30'));
  assert.equal(ds0101.actualArr, parseHHMM('09:20'));
  assert.equal(ds0101.delayMinutes, 30);

  // DS0102 scheduled 09:25, turnaround 35m -> 09:20 + 35 = 09:55 (+30m)
  const ds0102 = sim.flightsById['DS0102'];
  assert.equal(ds0102.status, 'DELAYED');
  assert.equal(ds0102.actualDep, parseHHMM('09:55'));
  assert.equal(ds0102.delayMinutes, 30);

  // DS0103 scheduled 10:50, turnaround 35m -> 10:45 + 35 = 11:20 (+30m)
  const ds0103 = sim.flightsById['DS0103'];
  assert.equal(ds0103.status, 'DELAYED');
  assert.equal(ds0103.delayMinutes, 30);

  // DS0104 scheduled 13:05, turnaround 70m -> 12:25 + 70 = 13:35 -> 13:05? Wait: 12:25 + 70 = 13:35 -> 30m delay?
  // Wait: DS0103 arr 11:55 + 30m = 12:25; 12:25 + 70m = 13:35 (30m delay)
  const ds0104 = sim.flightsById['DS0104'];
  assert.equal(ds0104.actualDep, parseHHMM('13:35'));
  assert.equal(ds0104.delayMinutes, 30);
});

test('3. AMD closure 06:20-07:30 (Preset A) delays DS1201, disrupts CX01 & CX02, propagates rotation', () => {
  const sim = runSimulation(dataset, {
    airport: 'AMD',
    startMinutes: parseHHMM('06:20'),
    durationMinutes: 70,
  });

  const ds1201 = sim.flightsById['DS1201'];
  assert.equal(ds1201.status, 'DELAYED');
  assert.equal(ds1201.actualDep, parseHHMM('07:30'));
  assert.equal(ds1201.actualArr, parseHHMM('08:40'));
  assert.equal(ds1201.delayMinutes, 60);

  // Rotation propagation across VT-DS12
  assert.equal(sim.flightsById['DS1202'].delayMinutes, 60);
  assert.equal(sim.flightsById['DS1203'].delayMinutes, 60);
  assert.equal(sim.flightsById['DS1204'].delayMinutes, 60);

  // Connections CX01 (43 pax) and CX02 (20 pax) and CX10 (18 pax) disrupted
  const cx01 = sim.connections.find((c) => c.connectionId === 'CX01')!;
  const cx02 = sim.connections.find((c) => c.connectionId === 'CX02')!;
  const cx10 = sim.connections.find((c) => c.connectionId === 'CX10')!;
  assert.equal(cx01.disrupted, true);
  assert.equal(cx02.disrupted, true);
  assert.equal(cx10.disrupted, true);
  assert.equal(sim.passengerImpact.disruptedConnectionPaxEvents, 43 + 20 + 18);
});

test('4. Aircraft delay propagation (Preset B: LKO 12:30-13:30 delays DS0104 and propagates to DS0105)', () => {
  const sim = runSimulation(dataset, {
    airport: 'LKO',
    startMinutes: parseHHMM('12:30'),
    durationMinutes: 60,
  });

  const ds0103 = sim.flightsById['DS0103'];
  const ds0104 = sim.flightsById['DS0104'];
  const ds0105 = sim.flightsById['DS0105'];

  assert.equal(ds0103.status, 'ON_TIME');
  assert.equal(ds0104.status, 'DELAYED');
  assert.equal(ds0104.delayMinutes, 25); // 13:05 -> 13:30
  assert.equal(ds0104.actualArr, parseHHMM('14:35'));

  // DS0105 requires 65m turnaround: 14:35 + 65m = 15:40 (scheduled 15:15 -> +25m)
  assert.equal(ds0105.status, 'DELAYED');
  assert.equal(ds0105.actualDep, parseHHMM('15:40'));
  assert.equal(ds0105.delayMinutes, 25);
  assert.equal(ds0105.causeType, 'TURNAROUND_PROPAGATION');
  assert.equal(ds0105.propagatedFromFlightId, 'DS0104');
});

test('5. Passenger connection disruption counts each connection record only once even if both flights cancelled', () => {
  // Cancel both DS1201 and DS1502 (which form CX01 with 43 pax)
  const sim = runSimulation(dataset, null, {
    cancelledFlightIds: new Set(['DS1201', 'DS1502']),
  });

  const cx01 = sim.connections.find((c) => c.connectionId === 'CX01')!;
  assert.equal(cx01.status, 'DISRUPTED_CANCELLED');
  assert.equal(cx01.disrupted, true);

  // Disrupted connections: CX01 (43), CX02 (20 from DS1201), CX03 (42 from DS1502), CX10 (18 from DS1203 cancelled via positioning)
  // Wait: DS1201 cancelled at AMD -> DS1202 cancelled (BOM->AMD), DS1203 (AMD->DEL) OPERATES because VT-DS12 is at AMD!
  // DS1502 cancelled at BOM -> DS1503 (DEL->JAI) cancelled (positioning at BOM), DS1504 (JAI->DEL) cancelled (positioning at BOM).
  // So CX01 counted ONCE (43), CX02 (20), CX03 (42) = 105!
  assert.equal(sim.summary.disruptedConnectionsCount, 3);
  assert.equal(sim.passengerImpact.disruptedConnectionPaxEvents, 43 + 20 + 42);
});

test('6. Cancellation and aircraft positioning: cancelling DS1201 cancels DS1202 and resumes at DS1203', () => {
  const closure = {
    airport: 'AMD',
    startMinutes: parseHHMM('06:20'),
    durationMinutes: 70,
  };
  const sim = runSimulation(dataset, closure, {
    cancelledFlightIds: new Set(['DS1201']),
  });

  assert.equal(sim.flightsById['DS1201'].status, 'CANCELLED');
  assert.equal(sim.flightsById['DS1201'].causeType, 'CANCELLED_ACTION');

  // VT-DS12 stayed at AMD, so DS1202 (BOM->AMD) must cancel due to positioning
  assert.equal(sim.flightsById['DS1202'].status, 'CANCELLED');
  assert.equal(sim.flightsById['DS1202'].causeType, 'CANCELLED_POSITIONING');

  // DS1203 originates at AMD, so VT-DS12 resumes its rotation on time!
  assert.equal(sim.flightsById['DS1203'].status, 'ON_TIME');
  assert.equal(sim.flightsById['DS1204'].status, 'ON_TIME');

  // CX10 (DS1203 -> DS0903) is saved!
  assert.equal(sim.connections.find((c) => c.connectionId === 'CX10')!.disrupted, false);
});

test('7. Spare aircraft substitution: VT-DS18 substitutes for DS0105 in LKO 12:30-13:30 and enforces feasibility', () => {
  const closure = {
    airport: 'LKO',
    startMinutes: parseHHMM('12:30'),
    durationMinutes: 60,
  };
  const original = runSimulation(dataset, closure);

  // Feasibility checks
  const validSub = checkSpareSubstitutionFeasibility(dataset, original, 'VT-DS18', 'DS0105');
  assert.equal(validSub.feasible, true);

  // Wrong base: VT-DS17 (BLR) cannot substitute for DS0105 (DEL)
  const wrongBase = checkSpareSubstitutionFeasibility(dataset, original, 'VT-DS17', 'DS0105');
  assert.equal(wrongBase.feasible, false);

  // Cancelled predecessor fails crew positioning check
  const withCancelledPred = runSimulation(dataset, closure, {
    cancelledFlightIds: new Set(['DS0104']),
  });
  const badCrewPos = checkSpareSubstitutionFeasibility(
    dataset,
    withCancelledPred,
    'VT-DS18',
    'DS0105'
  );
  assert.equal(badCrewPos.feasible, false);

  // Evaluate recovery candidate VT-DS18 on DS0105
  const recovery = evaluateSingleRecovery(dataset, closure, original, {
    type: 'SUBSTITUTE_SPARE',
    spareTailId: 'VT-DS18',
    flightId: 'DS0105',
  });
  assert.equal(recovery.feasible, true);
  assert.equal(recovery.improvesOverBaseline, true);
  assert.equal(recovery.simulation!.flightsById['DS0105'].status, 'ON_TIME');
  assert.equal(recovery.simulation!.flightsById['DS0105'].operatingTailId, 'VT-DS18');
  assert.equal(recovery.metrics!.totalArrivalDelayMinutes, 25); // down from 50!
});

test('8. Crew duty-limit violation and Not evaluated when no assigned flight operates', () => {
  // Close AMD from 06:20 for 120 minutes -> DS1201 delayed 110m (arr 09:30), cascades +110m to DS1204 (arr 16:10)
  // CR12 duty_start = 05:45 (345). 16:10 (970) - 345 = 625 mins > 600 max_duty_mins -> VIOLATION (+25m)!
  const sim = runSimulation(dataset, {
    airport: 'AMD',
    startMinutes: parseHHMM('06:20'),
    durationMinutes: 120,
  });

  const cr12 = sim.crews.find((c) => c.crewId === 'CR12')!;
  assert.equal(cr12.evaluated, true);
  assert.equal(cr12.dutyMinutes, 625);
  assert.equal(cr12.remainingHeadroomMinutes, -25);
  assert.equal(cr12.violation, true);
  assert.equal(cr12.overageMinutes, 25);
  assert.equal(sim.summary.crewDutyViolations >= 1, true);

  // Cancelling all flights of CR12 yields "Not evaluated"
  const allCancelled = runSimulation(dataset, null, {
    cancelledFlightIds: new Set(['DS1201', 'DS1202', 'DS1203', 'DS1204']),
  });
  const cr12None = allCancelled.crews.find((c) => c.crewId === 'CR12')!;
  assert.equal(cr12None.evaluated, false);
  assert.equal(cr12None.dutyMinutes, null);
  assert.equal(cr12None.violation, false);
});

test('9. Closure boundary conditions: half-open [start, end) and >1440 minute support', () => {
  // DS0101 departs DEL at 08:00 (480), arrives JAI at 08:50 (530)
  // Closure [08:00, 08:30): departure exactly at closure_start (08:00) is PROHIBITED -> moved to 08:30
  const depAtStart = runSimulation(dataset, {
    airport: 'DEL',
    startMinutes: parseHHMM('08:00'),
    durationMinutes: 30,
  });
  assert.equal(depAtStart.flightsById['DS0101'].status, 'DELAYED');
  assert.equal(depAtStart.flightsById['DS0101'].actualDep, parseHHMM('08:30'));

  // Closure [07:30, 08:00): departure exactly at closure_end (08:00) is PERMITTED -> ON_TIME
  const depAtEnd = runSimulation(dataset, {
    airport: 'DEL',
    startMinutes: parseHHMM('07:30'),
    durationMinutes: 30,
  });
  assert.equal(depAtEnd.flightsById['DS0101'].status, 'ON_TIME');
  assert.equal(depAtEnd.flightsById['DS0101'].actualDep, parseHHMM('08:00'));

  // DS0101 arrives JAI at 08:50 (530)
  // Closure at JAI [08:50, 09:10): arrival exactly at closure_start (08:50) is PROHIBITED -> arrives 09:10
  const arrAtStart = runSimulation(dataset, {
    airport: 'JAI',
    startMinutes: parseHHMM('08:50'),
    durationMinutes: 20,
  });
  assert.equal(arrAtStart.flightsById['DS0101'].status, 'DELAYED');
  assert.equal(arrAtStart.flightsById['DS0101'].actualArr, parseHHMM('09:10'));

  // Closure at JAI [08:20, 08:50): arrival exactly at closure_end (08:50) is PERMITTED -> ON_TIME
  const arrAtEnd = runSimulation(dataset, {
    airport: 'JAI',
    startMinutes: parseHHMM('08:20'),
    durationMinutes: 30,
  });
  assert.equal(arrAtEnd.flightsById['DS0101'].status, 'ON_TIME');
  assert.equal(arrAtEnd.flightsById['DS0101'].actualArr, parseHHMM('08:50'));

  // Late evening closure pushing arrival past midnight (>1440 mins) without wrapping to 0
  // DS1005: CCU->LKO dep 20:00 (1200), arr 21:45 (1305), block 105m
  // Close CCU 19:50 for 200m (ends 23:10 = 1390) -> dep 23:10 (1390), arr 1495 (00:55 +1d)
  const lateSim = runSimulation(dataset, {
    airport: 'CCU',
    startMinutes: parseHHMM('19:50'),
    durationMinutes: 200,
  });
  const ds1005 = lateSim.flightsById['DS1005'];
  assert.equal(ds1005.actualArr, 1495);
  assert.equal(formatMinutes(ds1005.actualArr), '00:55 (+1d)');
  assert.equal(ds1005.delayMinutes, 190);
});

test('10. Recovery that does not improve the outcome ranks below DO_NOTHING', () => {
  // DEL closure 07:30-08:30: substituting VT-DS18 for DS0101 (DEL->JAI dep 08:00)
  // still hits DEL closure at 08:00 -> identical metrics to DO_NOTHING, does NOT improve!
  const closure = {
    airport: 'DEL',
    startMinutes: parseHHMM('07:30'),
    durationMinutes: 60,
  };
  const original = runSimulation(dataset, closure);
  const subDs0101 = evaluateSingleRecovery(dataset, closure, original, {
    type: 'SUBSTITUTE_SPARE',
    spareTailId: 'VT-DS18',
    flightId: 'DS0101',
  });
  assert.equal(subDs0101.feasible, true);
  assert.equal(subDs0101.improvesOverBaseline, false);

  const { rankedFeasible } = evaluateRecoveryOptions(dataset, closure, original);
  const doNothingIdx = rankedFeasible.findIndex((c) => c.id === 'DO_NOTHING');
  const subIdx = rankedFeasible.findIndex((c) => c.id === 'SUB_VT-DS18_DS0101');
  assert.ok(doNothingIdx >= 0);
  assert.ok(subIdx > doNothingIdx, 'Non-improving spare substitution must rank after DO_NOTHING');
});

test('11. Regression: global 30m turnaround applies when resuming rotation after intervening cancellations (JAI 08:30-14:00 + cancel DS0103)', () => {
  const closure = {
    airport: 'JAI',
    startMinutes: parseHHMM('08:30'),
    durationMinutes: 330, // 08:30 to 14:00
  };
  const sim = runSimulation(dataset, closure, {
    cancelledFlightIds: new Set(['DS0103']),
  });

  const ds0101 = sim.flightsById['DS0101'];
  const ds0102 = sim.flightsById['DS0102'];
  const ds0103 = sim.flightsById['DS0103'];
  const ds0104 = sim.flightsById['DS0104'];
  const ds0105 = sim.flightsById['DS0105'];

  // DS0101 arrives JAI at 14:00
  assert.equal(ds0101.status, 'DELAYED');
  assert.equal(ds0101.actualArr, parseHHMM('14:00'));

  // DS0102 uses flight-specific 35m turnaround from DS0101: departs 14:35, arrives DEL 15:25
  assert.equal(ds0102.status, 'DELAYED');
  assert.equal(ds0102.requiredTurnaroundMinutes, 35);
  assert.equal(ds0102.actualDep, parseHHMM('14:35'));
  assert.equal(ds0102.actualArr, parseHHMM('15:25'));

  // DS0103 cancelled by action; DS0104 cancelled due to aircraft positioning
  assert.equal(ds0103.status, 'CANCELLED');
  assert.equal(ds0103.causeType, 'CANCELLED_ACTION');
  assert.equal(ds0104.status, 'CANCELLED');
  assert.equal(ds0104.causeType, 'CANCELLED_POSITIONING');

  // DS0105 resumes from DEL using global 30m turnaround (NOT 65m): 15:25 + 30m = 15:55 -> arr 16:45
  assert.equal(ds0105.status, 'DELAYED');
  assert.equal(ds0105.requiredTurnaroundMinutes, 30);
  assert.equal(ds0105.actualDep, parseHHMM('15:55'));
  assert.equal(ds0105.actualArr, parseHHMM('16:45'));
  assert.equal(ds0105.delayMinutes, 40);
  assert.match(ds0105.explanation, /30m global minimum turnaround/);

  // Also verify: if DS0101 (first leg) is cancelled so no prior flight operated, DS0103 resumes without invented turnaround
  const firstLegCancelled = runSimulation(dataset, null, {
    cancelledFlightIds: new Set(['DS0101']),
  });
  assert.equal(firstLegCancelled.flightsById['DS0101'].status, 'CANCELLED');
  assert.equal(firstLegCancelled.flightsById['DS0102'].status, 'CANCELLED');
  assert.equal(firstLegCancelled.flightsById['DS0102'].causeType, 'CANCELLED_POSITIONING');
  assert.equal(firstLegCancelled.flightsById['DS0103'].status, 'ON_TIME');
  assert.equal(firstLegCancelled.flightsById['DS0103'].requiredTurnaroundMinutes, 0);
  assert.match(
    firstLegCancelled.flightsById['DS0103'].explanation,
    /no prior operated flight turnaround required/
  );
});

test('12. Regression: AMD 06:20-07:30 recovery ranking prioritizes avoiding cancellations over missed connections', () => {
  const closure = {
    airport: 'AMD',
    startMinutes: parseHHMM('06:20'),
    durationMinutes: 70,
  };
  const original = runSimulation(dataset, closure);
  const { rankedFeasible } = evaluateRecoveryOptions(dataset, closure, original);

  const subDs1204 = rankedFeasible.find((c) => c.id === 'SUB_VT-DS18_DS1204');
  const doNothing = rankedFeasible.find((c) => c.id === 'DO_NOTHING');
  const cancelDs1201 = rankedFeasible.find((c) => c.id === 'CANCEL_DS1201');

  assert.ok(subDs1204 && subDs1204.feasible && subDs1204.metrics, 'SUB_VT-DS18_DS1204 must be feasible');
  assert.ok(doNothing && doNothing.feasible && doNothing.metrics, 'DO_NOTHING must be feasible');
  assert.ok(cancelDs1201 && cancelDs1201.feasible && cancelDs1201.metrics, 'CANCEL_DS1201 must be feasible');

  // A. Substituting VT-DS18 for DS1204
  assert.equal(subDs1204.metrics.cancelledFlights, 0);
  assert.equal(subDs1204.metrics.passengersOnCancelledFlights, 0);
  assert.equal(
    subDs1204.metrics.disruptedConnectionPaxEvents,
    original.summary.disruptedConnectionPaxEvents
  );
  assert.ok(
    subDs1204.metrics.passengerLegDelayMinutes < doNothing.metrics.passengerLegDelayMinutes,
    'SUB_VT-DS18_DS1204 should reduce passenger-leg delay minutes relative to DO_NOTHING'
  );
  assert.ok(
    subDs1204.metrics.totalArrivalDelayMinutes < doNothing.metrics.totalArrivalDelayMinutes,
    'SUB_VT-DS18_DS1204 should reduce total arrival-delay minutes relative to DO_NOTHING'
  );
  assert.equal(subDs1204.improvesOverBaseline, true);
  assert.ok(
    subDs1204.rank! < doNothing.rank!,
    'SUB_VT-DS18_DS1204 must rank above DO_NOTHING'
  );

  // B. Doing nothing ranks above cancelling DS1201
  assert.ok(
    doNothing.rank! < cancelDs1201.rank!,
    'DO_NOTHING must rank above CANCEL_DS1201'
  );

  // C. Cancelling DS1201 must not rank above non-cancellation option with equal crew outcome & better delay metrics,
  // and must expose its downstream cancellations and passenger impact
  assert.ok(
    subDs1204.rank! < cancelDs1201.rank!,
    'CANCEL_DS1201 must not rank above SUB_VT-DS18_DS1204'
  );
  assert.equal(cancelDs1201.improvesOverBaseline, false);
  assert.equal(cancelDs1201.metrics.cancelledFlights, 2);
  assert.equal(cancelDs1201.simulation!.flightsById['DS1201'].status, 'CANCELLED');
  assert.equal(cancelDs1201.simulation!.flightsById['DS1202'].status, 'CANCELLED');
  const expectedCancelledPax =
    dataset.flights.find((f) => f.flight_id === 'DS1201')!.pax +
    dataset.flights.find((f) => f.flight_id === 'DS1202')!.pax;
  assert.equal(cancelDs1201.metrics.passengersOnCancelledFlights, expectedCancelledPax);
  assert.ok(cancelDs1201.metrics.passengersOnCancelledFlights > 0);
});

test('13. Security: rate limiter ignores spoofed X-Forwarded-For and validator rejects malformed payloads', () => {
  const spoofedReq = {
    ip: '10.9.9.9',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.55' },
  } as unknown as Parameters<typeof getClientIp>[0];

  const resolvedIp = getClientIp(spoofedReq);
  assert.equal(resolvedIp, '127.0.0.1');

  const store = new Map<string, number[]>();
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(isRateLimited(resolvedIp, t0 + i * 1000, store).limited, false);
  }
  const sixth = isRateLimited(resolvedIp, t0 + 6000, store);
  assert.equal(sixth.limited, true);
  assert.ok(sixth.retryAfterSec >= 1);

  assert.equal(validateDispatchPayload(null).ok, false);
  assert.equal(validateDispatchPayload([]).ok, false);

  const closure = {
    airport: 'AMD',
    startMinutes: parseHHMM('06:20'),
    durationMinutes: 70,
  };
  const sim = runSimulation(dataset, closure);
  const { rankedFeasible } = evaluateRecoveryOptions(dataset, closure, sim);

  const validPayload = {
    scenario: {
      airport: 'AMD',
      airportName: 'Ahmedabad (Sardar Vallabhbhai Patel International)',
      closureStart: '06:20',
      closureEnd: '07:30',
      durationMinutes: 70,
    },
    baselineMetrics: sim.summary,
    affectedFlights: sim.flights
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
    disruptedConnections: sim.connections
      .filter((c) => c.disrupted)
      .map((c) => ({
        connectionId: c.connectionId,
        airport: c.airport,
        fromFlightId: c.fromFlightId,
        toFlightId: c.toFlightId,
        passengers: c.passengers,
        explanation: c.explanation,
      })),
    crewIssues: sim.crews.map((cr) => ({
      crewId: cr.crewId,
      tailId: cr.tailId,
      dutyMinutes: cr.dutyMinutes,
      maxDutyMinutes: cr.maxDutyMinutes,
      overageMinutes: cr.overageMinutes,
      violation: cr.violation,
    })),
    candidates: rankedFeasible.map((c) => ({
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

  assert.equal(validateDispatchPayload(validPayload).ok, true);

  const badCrewPayload = {
    ...validPayload,
    crewIssues: [{ crewId: 'CR01', tailId: 'VT-DS01', violation: 'invalid' }],
  };
  assert.equal(validateDispatchPayload(badCrewPayload).ok, false);
});


