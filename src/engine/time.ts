/**
 * Time utilities for Domino Sky simulation engine.
 * All internal times are integer minutes from 00:00 IST on the operating day.
 * Supports calculations beyond 1440 minutes without wrapping around to zero.
 */

export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid HH:MM time format: "${value}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Out-of-range HH:MM time value: "${value}"`);
  }
  return hours * 60 + minutes;
}

export function formatMinutes(totalMinutes: number | null): string {
  if (totalMinutes === null || !Number.isFinite(totalMinutes)) {
    return '—';
  }
  const rounded = Math.round(totalMinutes);
  const dayOffset = Math.floor(rounded / 1440);
  const inDay = ((rounded % 1440) + 1440) % 1440;
  const hours = Math.floor(inDay / 60);
  const mins = inDay % 60;
  const hhmm = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return dayOffset > 0 ? `${hhmm} (+${dayOffset}d)` : hhmm;
}

export function formatMinutesPlain(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatDurationMins(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) {
    return 'Not evaluated';
  }
  const abs = Math.abs(Math.round(minutes));
  const sign = minutes < 0 ? '-' : '';
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h 00m`;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}
