import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const requestLogByIp = new Map<string, number[]>();

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip: string, now: number): { limited: boolean; retryAfterSec: number } {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLogByIp.get(ip) ?? []).filter((ts) => ts > cutoff);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    requestLogByIp.set(ip, timestamps);
    return { limited: true, retryAfterSec };
  }

  timestamps.push(now);
  requestLogByIp.set(ip, timestamps);
  return { limited: false, retryAfterSec: 0 };
}

interface MetricsPayload {
  delayedFlights: number;
  cancelledFlights: number;
  totalArrivalDelayMinutes: number;
  disruptedConnectionPaxEvents: number;
  disruptedConnectionsCount: number;
  passengersOnCancelledFlights: number;
  passengerLegDelayMinutes: number;
  crewDutyViolations: number;
  totalCrewDutyOverageMinutes: number;
}

interface CandidatePayload {
  id: string;
  label: string;
  actionType: string;
  feasible: boolean;
  infeasibilityReason: string | null;
  rank: number | null;
  improvesOverBaseline: boolean;
  metrics: MetricsPayload | null;
}

interface DispatchRequestBody {
  scenario: {
    airport: string;
    airportName: string;
    closureStart: string;
    closureEnd: string;
    durationMinutes: number;
  };
  baselineMetrics: MetricsPayload;
  affectedFlights: Array<{
    flightId: string;
    tailId: string;
    origin: string;
    destination: string;
    delayMinutes: number;
    status: string;
    explanation: string;
  }>;
  disruptedConnections: Array<{
    connectionId: string;
    airport: string;
    fromFlightId: string;
    toFlightId: string;
    passengers: number;
    explanation: string;
  }>;
  crewIssues: Array<{
    crewId: string;
    tailId: string;
    dutyMinutes: number | null;
    maxDutyMinutes: number;
    overageMinutes: number;
    violation: boolean;
  }>;
  candidates: CandidatePayload[];
}

function isNonEmptyString(val: unknown, maxLen: number): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function isValidMetrics(m: unknown): m is MetricsPayload {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  const keys: (keyof MetricsPayload)[] = [
    'delayedFlights',
    'cancelledFlights',
    'totalArrivalDelayMinutes',
    'disruptedConnectionPaxEvents',
    'disruptedConnectionsCount',
    'passengersOnCancelledFlights',
    'passengerLegDelayMinutes',
    'crewDutyViolations',
    'totalCrewDutyOverageMinutes',
  ];
  return keys.every(
    (k) => typeof obj[k] === 'number' && Number.isFinite(obj[k]) && (obj[k] as number) >= 0
  );
}

function validateDispatchPayload(raw: unknown): { ok: true; data: DispatchRequestBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;
  const scenario = body.scenario as Record<string, unknown> | undefined;

  if (
    !scenario ||
    typeof scenario !== 'object' ||
    !isNonEmptyString(scenario.airport, 12) ||
    !isNonEmptyString(scenario.airportName, 160) ||
    !isNonEmptyString(scenario.closureStart, 24) ||
    !isNonEmptyString(scenario.closureEnd, 24) ||
    typeof scenario.durationMinutes !== 'number' ||
    !Number.isFinite(scenario.durationMinutes) ||
    scenario.durationMinutes <= 0 ||
    scenario.durationMinutes > 1440
  ) {
    return { ok: false, error: 'Invalid or incomplete scenario parameters.' };
  }

  if (!isValidMetrics(body.baselineMetrics)) {
    return { ok: false, error: 'Invalid baselineMetrics payload.' };
  }

  if (!Array.isArray(body.affectedFlights) || body.affectedFlights.length > 100) {
    return { ok: false, error: 'affectedFlights must be an array of at most 100 items.' };
  }
  for (const fl of body.affectedFlights) {
    if (
      !fl ||
      typeof fl !== 'object' ||
      !isNonEmptyString((fl as Record<string, unknown>).flightId, 24) ||
      !isNonEmptyString((fl as Record<string, unknown>).tailId, 24) ||
      !isNonEmptyString((fl as Record<string, unknown>).origin, 12) ||
      !isNonEmptyString((fl as Record<string, unknown>).destination, 12) ||
      !isNonEmptyString((fl as Record<string, unknown>).status, 24)
    ) {
      return { ok: false, error: 'Invalid entry in affectedFlights.' };
    }
  }

  if (!Array.isArray(body.disruptedConnections) || body.disruptedConnections.length > 50) {
    return { ok: false, error: 'disruptedConnections must be an array of at most 50 items.' };
  }
  for (const cx of body.disruptedConnections) {
    if (
      !cx ||
      typeof cx !== 'object' ||
      !isNonEmptyString((cx as Record<string, unknown>).connectionId, 24) ||
      !isNonEmptyString((cx as Record<string, unknown>).airport, 12) ||
      !isNonEmptyString((cx as Record<string, unknown>).fromFlightId, 24) ||
      !isNonEmptyString((cx as Record<string, unknown>).toFlightId, 24)
    ) {
      return { ok: false, error: 'Invalid entry in disruptedConnections.' };
    }
  }

  if (!Array.isArray(body.crewIssues) || body.crewIssues.length > 50) {
    return { ok: false, error: 'crewIssues must be an array of at most 50 items.' };
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0 || body.candidates.length > 100) {
    return { ok: false, error: 'candidates must be a non-empty array of at most 100 items.' };
  }
  for (const c of body.candidates) {
    if (!c || typeof c !== 'object') {
      return { ok: false, error: 'Invalid entry in candidates.' };
    }
    const cand = c as Record<string, unknown>;
    if (
      !isNonEmptyString(cand.id, 64) ||
      !isNonEmptyString(cand.label, 160) ||
      typeof cand.feasible !== 'boolean'
    ) {
      return { ok: false, error: 'Invalid candidate metadata.' };
    }
    if (cand.feasible && !isValidMetrics(cand.metrics)) {
      return { ok: false, error: `Feasible candidate ${cand.id} is missing valid metrics.` };
    }
  }

  return { ok: true, data: body as unknown as DispatchRequestBody };
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({ ok: true, aiConfigured });
  });

  app.post('/api/ai-dispatch', async (req, res) => {
    const clientIp = getClientIp(req);
    const rate = isRateLimited(clientIp, Date.now());
    if (rate.limited) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        available: false,
        error:
          'Rate limit exceeded for AI dispatcher (maximum 5 requests per minute). Deterministic recovery rankings remain active.',
      });
      return;
    }

    const validation = validateDispatchPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({
        available: false,
        error: validation.error,
      });
      return;
    }

    const body = validation.data;
    const feasibleCandidates = body.candidates.filter((c) => c.feasible && c.metrics !== null);
    if (feasibleCandidates.length === 0) {
      res.status(400).json({
        available: false,
        error: 'No feasible recovery candidates were provided for evaluation.',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        available: false,
        error:
          'Gemini API access is not configured on the server. Deterministic recovery rankings remain active.',
      });
      return;
    }

    try {
      const promptPayload = {
        scenario: {
          airport: body.scenario.airport,
          airportName: body.scenario.airportName,
          closureStart: body.scenario.closureStart,
          closureEnd: body.scenario.closureEnd,
        },
        originalDisruptionMetrics: body.baselineMetrics,
        affectedFlightsSample: body.affectedFlights.slice(0, 25).map((f) => ({
          flightId: f.flightId,
          tailId: f.tailId,
          origin: f.origin,
          destination: f.destination,
          status: f.status,
          explanation: f.explanation.slice(0, 200),
        })),
        disruptedConnections: body.disruptedConnections.map((c) => ({
          connectionId: c.connectionId,
          airport: c.airport,
          fromFlightId: c.fromFlightId,
          toFlightId: c.toFlightId,
        })),
        crewDutyViolations: body.crewIssues
          .filter((c) => c.violation)
          .map((c) => ({ crewId: c.crewId, tailId: c.tailId, violation: c.violation })),
        evaluatedFeasibleCandidates: feasibleCandidates.slice(0, 15).map((c) => ({
          id: c.id,
          label: c.label,
          rank: c.rank,
          improvesOverBaseline: c.improvesOverBaseline,
          metrics: c.metrics,
        })),
      };

      const systemInstruction = [
        'You are an airline operations recovery advisor for the Domino Sky deterministic simulator.',
        'STRICT RULES FOR QUALITATIVE EXPLANATION:',
        '1. DO NOT repeat numerical passenger counts, delay minutes, duty durations, headroom minutes, or numerical recovery claims (no numbers for passengers, minutes, or counts in your prose). All numerical metrics are rendered separately by the deterministic UI.',
        '2. NEVER invent, modify, estimate, or calculate any flight delays, passenger counts, or crew statistics.',
        '3. You MAY reference exact identifiers from the payload: airport codes (e.g., AMD, DEL, LKO), flight IDs (e.g., DS1201), connection IDs (e.g., CX01), crew IDs (e.g., CR12), aircraft tail IDs (e.g., VT-DS12, VT-DS18), and candidate IDs.',
        '4. You MUST choose recommendedCandidateId exclusively from evaluatedFeasibleCandidates[].id, respecting the deterministic rank order (crew duty violations, total crew duty overage, passengers on cancelled flights, number of cancelled flights, disrupted connection passenger-events, passenger-leg delay, total arrival delay). Do NOT recommend a candidate solely because it has fewer missed connections when it imposes cancelled-flight passenger impact and a better-ranked feasible alternative exists.',
        '5. Explain causal rotation propagation, passenger/crew consequences, recommendation rationale, and operational trade-offs qualitatively in 2 concise sentences per field.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this deterministic airport closure scenario qualitatively and recommend one feasible candidate from evaluatedFeasibleCandidates without citing numerical passenger counts, delay minutes, duty durations, or numerical recovery claims:\n\n${JSON.stringify(promptPayload)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recommendedCandidateId: {
                type: Type.STRING,
                description: 'Exact id from evaluatedFeasibleCandidates.',
              },
              disruptionSummary: {
                type: Type.STRING,
                description:
                  'Qualitative summary of the airport closure and directly affected flight IDs without numerical counts or minutes.',
              },
              rotationPropagationExplanation: {
                type: Type.STRING,
                description:
                  'Qualitative explanation of how the disruption propagated through aircraft tail rotations and turnaround dependencies using exact tail and flight IDs.',
              },
              passengerAndCrewConsequences: {
                type: Type.STRING,
                description:
                  'Qualitative impact on connection IDs and crew IDs/duty limits without repeating numerical passenger counts or duty minutes.',
              },
              recommendationRationale: {
                type: Type.STRING,
                description:
                  'Qualitative explanation of why the recommendedCandidateId is preferred under the deterministic ranking hierarchy without numerical recovery claims.',
              },
              tradeOffs: {
                type: Type.STRING,
                description:
                  'Qualitative operational trade-offs and model assumptions (such as cancelled outbound legs vs restored downstream flights, or zero aircraft-switch time).',
              },
            },
            required: [
              'recommendedCandidateId',
              'disruptionSummary',
              'rotationPropagationExplanation',
              'passengerAndCrewConsequences',
              'recommendationRationale',
              'tradeOffs',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({
          available: false,
          error:
            'AI dispatcher returned an empty response. Deterministic recovery rankings remain active.',
        });
        return;
      }

      const parsed = JSON.parse(rawText) as {
        recommendedCandidateId: string;
        disruptionSummary: string;
        rotationPropagationExplanation: string;
        passengerAndCrewConsequences: string;
        recommendationRationale: string;
        tradeOffs: string;
      };

      const matchedCandidate = body.candidates.find(
        (c) => c.id === parsed.recommendedCandidateId
      );
      const isValidAndFeasible = Boolean(matchedCandidate && matchedCandidate.feasible);

      if (!isValidAndFeasible) {
        res.json({
          available: true,
          recommendedCandidateId: null,
          disruptionSummary: String(parsed.disruptionSummary ?? '').slice(0, 600),
          rotationPropagationExplanation: String(
            parsed.rotationPropagationExplanation ?? ''
          ).slice(0, 600),
          passengerAndCrewConsequences: String(parsed.passengerAndCrewConsequences ?? '').slice(
            0,
            600
          ),
          recommendationRationale: String(parsed.recommendationRationale ?? '').slice(0, 600),
          tradeOffs: String(parsed.tradeOffs ?? '').slice(0, 600),
          validatedFeasible: false,
          validationMessage:
            'AI response did not reference a valid feasible candidate ID from the deterministic engine. Refer to the deterministic ranking table.',
        });
        return;
      }

      res.json({
        available: true,
        recommendedCandidateId: parsed.recommendedCandidateId,
        disruptionSummary: String(parsed.disruptionSummary ?? '').slice(0, 600),
        rotationPropagationExplanation: String(
          parsed.rotationPropagationExplanation ?? ''
        ).slice(0, 600),
        passengerAndCrewConsequences: String(parsed.passengerAndCrewConsequences ?? '').slice(
          0,
          600
        ),
        recommendationRationale: String(parsed.recommendationRationale ?? '').slice(0, 600),
        tradeOffs: String(parsed.tradeOffs ?? '').slice(0, 600),
        validatedFeasible: true,
        validationMessage: `Verified against deterministic engine: ${parsed.recommendedCandidateId} (Rank #${matchedCandidate?.rank ?? '—'}).`,
      });
    } catch (err: unknown) {
      // Log sanitized error server-side only; never expose stack traces or provider internals to the client
      const safeCode =
        err && typeof err === 'object' && 'status' in err
          ? String((err as { status: unknown }).status)
          : 'upstream_error';
      console.error(`[ai-dispatch] Gemini request failed (${safeCode}).`);
      res.status(502).json({
        available: false,
        error:
          'AI dispatcher service is temporarily unavailable. Deterministic recovery rankings remain active.',
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Domino Sky server listening on http://0.0.0.0:${PORT}`);
  });
}

createApp();
