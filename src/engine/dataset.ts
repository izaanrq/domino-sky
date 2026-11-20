import { parseHHMM } from './time';
import type { FlightNetworkDataset } from './types';

export function validateFlightNetworkDataset(raw: unknown): FlightNetworkDataset {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Dataset must be a JSON object.');
  }

  const data = raw as Partial<FlightNetworkDataset>;

  if (!data.meta || typeof data.meta.min_turnaround_minutes !== 'number' || typeof data.meta.seats_per_aircraft !== 'number') {
    throw new Error('Dataset meta is missing min_turnaround_minutes or seats_per_aircraft.');
  }
  if (!Array.isArray(data.airports) || data.airports.length === 0) {
    throw new Error('Dataset airports array is missing or empty.');
  }
  if (!Array.isArray(data.flights) || data.flights.length === 0) {
    throw new Error('Dataset flights array is missing or empty.');
  }
  if (!Array.isArray(data.connections)) {
    throw new Error('Dataset connections array is missing.');
  }
  if (!Array.isArray(data.crews) || data.crews.length === 0) {
    throw new Error('Dataset crews array is missing or empty.');
  }
  if (!Array.isArray(data.spare_aircraft)) {
    throw new Error('Dataset spare_aircraft array is missing.');
  }

  const airportIds = new Set<string>();
  for (const ap of data.airports) {
    if (!ap.id || !ap.name || !ap.city || typeof ap.lat !== 'number' || typeof ap.lng !== 'number') {
      throw new Error(`Invalid airport record: ${JSON.stringify(ap)}`);
    }
    if (airportIds.has(ap.id)) {
      throw new Error(`Duplicate airport id: ${ap.id}`);
    }
    airportIds.add(ap.id);
  }

  const flightIds = new Set<string>();
  const tailIds = new Set<string>();
  for (const fl of data.flights) {
    if (!fl.flight_id || !fl.tail_id || typeof fl.leg_order !== 'number') {
      throw new Error(`Invalid flight record: ${JSON.stringify(fl)}`);
    }
    if (flightIds.has(fl.flight_id)) {
      throw new Error(`Duplicate flight_id: ${fl.flight_id}`);
    }
    if (!airportIds.has(fl.origin) || !airportIds.has(fl.destination)) {
      throw new Error(`Flight ${fl.flight_id} references unknown airport (${fl.origin} -> ${fl.destination}).`);
    }
    const dep = parseHHMM(fl.dep);
    const arr = parseHHMM(fl.arr);
    if (arr - dep !== fl.block_minutes) {
      throw new Error(`Flight ${fl.flight_id} block_minutes (${fl.block_minutes}) does not match dep/arr (${arr - dep}).`);
    }
    if (typeof fl.pax !== 'number' || fl.pax < 0) {
      throw new Error(`Flight ${fl.flight_id} has invalid passenger count: ${fl.pax}`);
    }
    flightIds.add(fl.flight_id);
    tailIds.add(fl.tail_id);
  }

  const connectionIds = new Set<string>();
  for (const cx of data.connections) {
    if (!cx.connection_id || !airportIds.has(cx.airport)) {
      throw new Error(`Connection ${cx.connection_id} references invalid airport.`);
    }
    if (!flightIds.has(cx.from_flight) || !flightIds.has(cx.to_flight)) {
      throw new Error(`Connection ${cx.connection_id} references unknown flight.`);
    }
    if (connectionIds.has(cx.connection_id)) {
      throw new Error(`Duplicate connection_id: ${cx.connection_id}`);
    }
    connectionIds.add(cx.connection_id);
  }

  const crewIds = new Set<string>();
  for (const cr of data.crews) {
    if (!cr.crew_id || !tailIds.has(cr.tail_id) || !airportIds.has(cr.base)) {
      throw new Error(`Invalid crew record ${cr.crew_id}.`);
    }
    parseHHMM(cr.duty_start);
    if (typeof cr.max_duty_mins !== 'number' || cr.max_duty_mins <= 0) {
      throw new Error(`Invalid max_duty_mins for crew ${cr.crew_id}.`);
    }
    for (const fid of cr.flight_ids) {
      if (!flightIds.has(fid)) {
        throw new Error(`Crew ${cr.crew_id} references unknown flight ${fid}.`);
      }
    }
    if (crewIds.has(cr.crew_id)) {
      throw new Error(`Duplicate crew_id: ${cr.crew_id}`);
    }
    crewIds.add(cr.crew_id);
  }

  for (const sp of data.spare_aircraft) {
    if (!sp.tail_id || !airportIds.has(sp.base) || typeof sp.seats !== 'number') {
      throw new Error(`Invalid spare_aircraft record: ${JSON.stringify(sp)}`);
    }
    parseHHMM(sp.available_from);
  }

  return data as FlightNetworkDataset;
}
