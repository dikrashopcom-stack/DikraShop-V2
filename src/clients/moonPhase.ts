import { logger } from "../utils/logger";

// The 8 local moon asset names (maps to assets/moons/<name>.png)
export type MoonPhaseName =
  | "new_moon"
  | "waxing_crescent"
  | "first_quarter"
  | "waxing_gibbous"
  | "full_moon"
  | "waning_gibbous"
  | "last_quarter"
  | "waning_crescent";

export interface MoonPhaseResult {
  rawPhase: string;           // human-readable name, e.g. "Waxing Gibbous"
  mappedPhase: MoonPhaseName; // asset key, e.g. "waxing_gibbous"
  illumination: number;       // 0–1
  age: number;                // days since last new moon (0–29.53)
}

// ── Astronomical constants ─────────────────────────────────────────────────────

/** Known new moon reference: 6 Jan 2000 18:14 UTC → Julian Day 2451550.1 */
const KNOWN_NEW_MOON_JD = 2451550.1;

/** Mean synodic month (new moon to new moon) in days */
const LUNAR_CYCLE = 29.53058867;

// ── Core calculation (no network required) ────────────────────────────────────

/**
 * Converts a calendar date to a Julian Day Number.
 * Uses the standard astronomical formula.
 */
function toJulianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-based
  const d =
    date.getUTCDate() +
    date.getUTCHours() / 24 +
    date.getUTCMinutes() / 1440 +
    date.getUTCSeconds() / 86400;

  const A = Math.floor((14 - m) / 12);
  const Y = y + 4800 - A;
  const M = m + 12 * A - 3;

  return (
    d +
    Math.floor((153 * M + 2) / 5) +
    365 * Y +
    Math.floor(Y / 4) -
    Math.floor(Y / 100) +
    Math.floor(Y / 400) -
    32045
  );
}

/**
 * Returns the moon's age in days (0 = new moon, ~14.77 = full moon).
 */
function moonAge(date: Date): number {
  const jd = toJulianDay(date);
  const daysSinceRef = jd - KNOWN_NEW_MOON_JD;
  const age = ((daysSinceRef % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE;
  return age;
}

/**
 * Maps moon age (0–29.53 days) to one of 8 phase names.
 *
 * Phase boundaries (each phase spans ~3.69 days = cycle/8):
 *   0.0 –  1.85  →  New Moon          (within ±1.85 days of new moon)
 *   1.85–  7.38  →  Waxing Crescent
 *   7.38–  9.22  →  First Quarter     (within ±0.92 days of quarter)
 *   9.22– 14.77  →  Waxing Gibbous
 *  14.77– 16.61  →  Full Moon         (within ±0.92 days of full moon)
 *  16.61– 22.15  →  Waning Gibbous
 *  22.15– 24.00  →  Last Quarter      (within ±0.92 days of quarter)
 *  24.00– 29.53  →  Waning Crescent
 */
function ageToPhase(age: number): { rawPhase: string; mappedPhase: MoonPhaseName } {
  if (age < 1.85 || age >= 27.68) {
    return { rawPhase: "New Moon",        mappedPhase: "new_moon" };
  } else if (age < 7.38) {
    return { rawPhase: "Waxing Crescent", mappedPhase: "waxing_crescent" };
  } else if (age < 9.22) {
    return { rawPhase: "First Quarter",   mappedPhase: "first_quarter" };
  } else if (age < 14.77) {
    return { rawPhase: "Waxing Gibbous",  mappedPhase: "waxing_gibbous" };
  } else if (age < 16.61) {
    return { rawPhase: "Full Moon",       mappedPhase: "full_moon" };
  } else if (age < 22.15) {
    return { rawPhase: "Waning Gibbous",  mappedPhase: "waning_gibbous" };
  } else if (age < 24.00) {
    return { rawPhase: "Last Quarter",    mappedPhase: "last_quarter" };
  } else {
    return { rawPhase: "Waning Crescent", mappedPhase: "waning_crescent" };
  }
}

/**
 * Calculates moon illumination (0–1) from age.
 * Uses a cosine approximation: 0 at new moon, 1 at full moon.
 */
function ageToIllumination(age: number): number {
  return (1 - Math.cos((2 * Math.PI * age) / LUNAR_CYCLE)) / 2;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Computes the moon phase for a given date using local astronomical math.
 * No network call required — works offline and is always available.
 */
export async function getMoonPhase(date: Date): Promise<MoonPhaseResult> {
  logger.info("Computing moon phase (local calculation)", { date: date.toISOString() });

  const age = moonAge(date);
  const { rawPhase, mappedPhase } = ageToPhase(age);
  const illumination = ageToIllumination(age);

  logger.info("Moon phase computed", { rawPhase, mappedPhase, age: +age.toFixed(2), illumination: +illumination.toFixed(3) });

  return { rawPhase, mappedPhase, illumination, age };
}
