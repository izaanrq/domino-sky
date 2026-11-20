export type AirportTier = 'mega_hub' | 'regional_hub' | 'spoke';

export interface DatasetMeta {
  dataset: string;
  operating_day: string;
  min_turnaround_minutes: number;
  seats_per_aircraft: number;
  notes?: string[];
}

export interface Airport {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  tier: AirportTier;
  capacity_per_hour: number;
}

export interface FlightRecord {
  flight_id: string;
  tail_id: string;
  leg_order: number;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
  block_minutes: number;
  pax: number;
  turnaround_before_min: number | null;
}

export interface ConnectionRecord {
  connection_id: string;
  airport: string;
  from_flight: string;
  to_flight: string;
  passengers: number;
  min_connect_minutes: number;
}

export interface CrewRecord {
  crew_id: string;
  tail_id: string;
  base: string;
  duty_start: string;
  max_duty_mins: number;
  flight_ids: string[];
}

export interface SpareAircraftRecord {
  tail_id: string;
  base: string;
  available_from: string;
  seats: number;
}

export interface FlightNetworkDataset {
  meta: DatasetMeta;
  airports: Airport[];
  flights: FlightRecord[];
  connections: ConnectionRecord[];
  crews: CrewRecord[];
  spare_aircraft: SpareAircraftRecord[];
}

export interface AirportClosure {
  airport: string;
  startMinutes: number;
  durationMinutes: number;
}

export type FlightStatus = 'ON_TIME' | 'DELAYED' | 'CANCELLED';

export type DelayCauseType =
  | 'NONE'
  | 'ORIGIN_CLOSURE'
  | 'DESTINATION_CLOSURE'
  | 'TURNAROUND_PROPAGATION'
  | 'CREW_POSITIONING_WAIT'
  | 'CANCELLED_ACTION'
  | 'CANCELLED_POSITIONING';

export interface FlightSimulationResult {
  flightId: string;
  originalTailId: string;
  operatingTailId: string;
  substitutedBySpare: boolean;
  legOrder: number;
  origin: string;
  destination: string;
  pax: number;
  blockMinutes: number;
  requiredTurnaroundMinutes: number;
  scheduledDep: number;
  scheduledArr: number;
  actualDep: number | null;
  actualArr: number | null;
  delayMinutes: number;
  status: FlightStatus;
  causeType: DelayCauseType;
  propagatedFromFlightId: string | null;
  explanation: string;
}

export interface AircraftFinalState {
  tailId: string;
  isSpare: boolean;
  currentAirport: string;
  availableTime: number | null;
  lastOperatedArrival: number | null;
  lastOperatedFlightId: string | null;
  assignedFlightIds: string[];
  operatedFlightIds: string[];
  cancelledFlightIds: string[];
}

export type ConnectionStatus = 'MADE' | 'MISSED_TIME' | 'DISRUPTED_CANCELLED';

export interface ConnectionSimulationResult {
  connectionId: string;
  airport: string;
  fromFlightId: string;
  toFlightId: string;
  passengers: number;
  minConnectMinutes: number;
  fromActualArrival: number | null;
  toActualDeparture: number | null;
  actualConnectMinutes: number | null;
  status: ConnectionStatus;
  disrupted: boolean;
  explanation: string;
}

export interface CrewSimulationResult {
  crewId: string;
  tailId: string;
  base: string;
  dutyStartMinutes: number;
  maxDutyMinutes: number;
  assignedFlightIds: string[];
  operatedFlightIds: string[];
  lastOperatedFlightId: string | null;
  lastOperatedArrival: number | null;
  evaluated: boolean;
  dutyMinutes: number | null;
  remainingHeadroomMinutes: number | null;
  violation: boolean;
  overageMinutes: number;
}

export interface PassengerImpactMetrics {
  disruptedConnectionPaxEvents: number;
  disruptedConnectionsCount: number;
  passengersOnCancelledFlights: number;
  passengersOnDelayedOperatedFlights: number;
  passengerLegDelayMinutes: number;
}

export interface SimulationSummaryMetrics {
  totalFlights: number;
  operatedFlights: number;
  onTimeFlights: number;
  delayedFlights: number;
  cancelledFlights: number;
  totalArrivalDelayMinutes: number;
  maxFlightDelayMinutes: number;
  disruptedConnectionPaxEvents: number;
  disruptedConnectionsCount: number;
  passengersOnCancelledFlights: number;
  passengersOnDelayedOperatedFlights: number;
  passengerLegDelayMinutes: number;
  crewDutyViolations: number;
  totalCrewDutyOverageMinutes: number;
  evaluatedCrews: number;
}

export interface SimulationResult {
  closure: AirportClosure | null;
  closureEndMinutes: number | null;
  flights: FlightSimulationResult[];
  flightsById: Record<string, FlightSimulationResult>;
  aircraftStates: AircraftFinalState[];
  connections: ConnectionSimulationResult[];
  crews: CrewSimulationResult[];
  passengerImpact: PassengerImpactMetrics;
  summary: SimulationSummaryMetrics;
}

export type RecoveryAction =
  | { type: 'DO_NOTHING' }
  | { type: 'CANCEL_FLIGHT'; flightId: string }
  | { type: 'SUBSTITUTE_SPARE'; spareTailId: string; flightId: string };

export interface RecoveryCandidate {
  id: string;
  action: RecoveryAction;
  label: string;
  description: string;
  feasible: boolean;
  infeasibilityReason: string | null;
  rank: number | null;
  improvesOverBaseline: boolean;
  simulation: SimulationResult | null;
  metrics: SimulationSummaryMetrics | null;
  assumptions: string[];
}

export interface AIDispatchRecommendation {
  available: boolean;
  recommendedCandidateId: string | null;
  disruptionSummary: string;
  rotationPropagationExplanation: string;
  passengerAndCrewConsequences: string;
  recommendationRationale: string;
  tradeOffs: string;
  validatedFeasible: boolean;
  validationMessage: string | null;
  error?: string;
}
