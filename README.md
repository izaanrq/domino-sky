# DOMINO SKY — Flight Disruption Cascade & Recovery Simulator

DOMINO SKY is a deterministic airline operations disruption simulator and recovery comparison dashboard built for a single-day, 16-airport, 70-flight IST network (`public/assets/aistudio/flight_network_78529dd1.json`).

> **Prototype Disclosure:** DOMINO SKY is a hackathon operations simulation prototype. Its simplified model assumptions are not a certified real-world airline operations control system.

---

## What the Application Does

- **Airport Closure Simulation:** Close any of the 16 Indian airports for a chosen start time (`HH:MM` IST) and duration in minutes.
- **Rotation Cascade Propagation:** Propagates delays across each aircraft's `leg_order` rotation without teleporting aircraft, tracking explicit causal explanations for every flight.
- **Passenger & Crew Impact Analysis:**
  - Evaluates all 21 passenger connection records (counting each record once, even if both flights are cancelled).
  - Reports distinct passenger impact lenses (disrupted connection passenger-events, passengers on cancelled flights, passengers on delayed operated flights, and passenger-leg delay minutes) without summing them into a single unique passenger figure.
  - Evaluates crew duty durations against `max_duty_mins` (600 minutes), reporting headroom, violations, or `Not evaluated` if no assigned flight operates.
- **Deterministic Recovery Engine:** Evaluates `DO_NOTHING`, single-flight cancellations, and spare aircraft substitutions (`VT-DS17` at `BLR`, `VT-DS18` at `DEL`), filters infeasible options, and ranks feasible options lexicographically.
- **Before / After Comparison & Custom SVG Network Map:** Plots all 16 airports by latitude/longitude, visualizes normal/delayed/cancelled corridors, renders per-aircraft rotation swimlanes, and compares original disruption vs. selected recovery metrics.
- **Qualitative AI Dispatcher:** Uses a server-side Gemini endpoint (`POST /api/ai-dispatch`) to provide qualitative operational briefings and validated candidate selections grounded in deterministic outputs. If Gemini is unavailable, deterministic recovery rankings remain fully operational.

---

## Deterministic Simulation Rules & Assumptions

1. **Time Representation:** All `HH:MM` IST timestamps are converted to integer minutes from `00:00` and support calculations beyond `1440` minutes (`+1d`) without wrapping to zero.
2. **Half-Open Airport Closure Interval:** Closures apply over `[closure_start, closure_end)`. Departures or arrivals at `closure_start` are prohibited; departures or arrivals at `closure_end` are permitted.
3. **Turnaround & Post-Cancellation Resumption:**
   - When the immediately preceding assigned flight operated normally, turnaround is `max(30, flight.turnaround_before_min)`.
   - When one or more intervening flights are cancelled and the aircraft later resumes its rotation at its physical airport, the global minimum turnaround (`30` minutes) is applied from the aircraft's last actual operated arrival.
   - If no previous flight ever operated on the aircraft, no prior arrival or turnaround is invented.
4. **Cancellations & Positioning:** Cancelled flights do not move the aircraft. Subsequent legs originating elsewhere are cancelled due to aircraft positioning; if a later leg originates at the aircraft's actual airport, the rotation resumes.
5. **Spare Aircraft Substitutions:**
   - Spare base must match the selected flight origin, spare must be available/unused, seat capacity (`180`) must accommodate all subsequent legs, subsequent legs must form a continuous rotation, and the original crew must be position-feasible at the replacement point.
   - **Assumptions:** Fixed block times, single airport closure per scenario, and zero additional aircraft-switch time when transferring the original crew to a spare aircraft.
6. **Lexicographic Recovery Ranking:** Feasible candidates are ranked strictly by:
   1. Crew duty-limit violations
   2. Total crew duty overage minutes
   3. Passengers on cancelled flights
   4. Number of cancelled flights
   5. Disrupted connection passenger-events
   6. Passenger-leg delay minutes
   7. Total flight arrival-delay minutes

---

## Installation & Commands

```bash
# Install dependencies
npm install

# Run development server (Express + Vite middleware on port 3000)
npm run dev

# TypeScript check
npm run lint

# Run deterministic simulation & recovery unit tests
npm run test

# Build frontend (dist/) and bundle production server (server.js)
npm run build

# Run full verification suite (lint + test + build)
npm run check

# Start production server (compiled JavaScript via Node.js)
NODE_ENV=production npm run start
```

---

## Configuring the Gemini API Secret Safely

- The Gemini client runs exclusively on the server (`server.ts` / compiled `server.js`) and reads `process.env.GEMINI_API_KEY`.
- Never place API keys in `VITE_*` client environment variables, frontend code, or committed files.
- Set `GEMINI_API_KEY` in the runtime environment or **Settings > Secrets** (for local development, place it in an untracked `.env` file based on `.env.example`).
- `/api/ai-dispatch` enforces payload validation, a 64 KB body limit, and a 5-requests-per-minute per-IP rate limit, and never returns raw stack traces or credentials to the browser.
