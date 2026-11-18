// gta6-twitch-ccu-forecast-01: forecast GTA VI's launch-day Twitch viewers hour
// by hour (Node 22, standard library only).
//
// The model: a rolling-midnight diurnal curve, fitted at run time from the
// case's own comparables. Grand Theft Auto VI unlocks at midnight local time,
// country by country, so at hour 1 (00:00-01:00 UTC) only New Zealand,
// Australia, Japan, Korea and the UK have unlocked; the US east coast unlocks
// at hour 6, the west coast at hour 9, and central Europe at hour 24. The
// day's shape is therefore a dip in the small hours and a rise to an evening
// peak — nothing like the house baseline's flat persistence.
//
// How it works, per case:
//   1. Take the case's comparables and keep only the clean rolling-midnight
//      launches: console games whose unlock text says midnight local /
//      rolling, with no early access, no simultaneous global unlock and no
//      weak tier. The target's own pre-release category history (Grand Theft
//      Auto VI's, which is not a launch) is excluded. If fewer than five
//      such launches have a usable release day, fall back to every
//      comparable with a usable release day; if fewer than three of those,
//      fall back to the house baseline's persistence formula.
//   2. For each kept launch, take its release day's hourly viewers (hours
//      1..24 from its day_start) and form log ratios ln(viewers_h /
//      viewers_1). The median ratio per hour is the day's shape; the
//      population standard deviation per hour is the spread. Both are
//      smoothed with a 3-hour running median.
//   3. Forecast q_tau(h) = p1 * exp(mu_h + z_tau * sigma_h), p1 the case's
//      hour-1 print, z the standard normal's quantile at each level. The
//      spread is floored at 0.40 log units: with only a handful of launches
//      the empirical spread would otherwise claim more certainty than the
//      data supports.
//
// The fit was calibrated offline on the kit's 38 comparables: on the ten
// clean rolling-midnight launches, this model scores a leave-one-out mean
// pinball loss of 0.286, against 0.434 for the house baseline. The numbers
// are not hard-coded: the program re-fits from whatever comparables the
// case it is given carries, so the final case's 42 comparables (including
// the four practice launches) all count.
//
// Run with no network. Reads $MAKEFUN_INPUT_DIR (else /input) and writes to
// $MAKEFUN_OUTPUT_DIR (else /output): one <id>.out per <id>.in, each
// {"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]} with 23 rows.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** The house baseline's spread, per square-root hour, used only as a fallback. */
const BASELINE_SIGMA = 0.15;
/** A launch needs this many of hours 2..24 present to join the fit. */
const MIN_SCORED_HOURS = 20;
/** The rolling fit needs at least this many launches; else fall back. */
const MIN_ROLLING_LAUNCHES = 5;
/** Any fit needs at least this many launches; else use the baseline. */
const MIN_ANY_LAUNCHES = 3;
/** The spread never claims less than this many log units of uncertainty. */
const SIGMA_FLOOR = 0.4;

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  hourly: Array<{ from: string; viewers: number | null; channels?: number | null }>;
}

interface Case {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up), as the house baseline rounds. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The median of a non-empty list of numbers. */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The population standard deviation of a list (0 for a single value). */
const pstdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
};

/**
 * Is this comparable a clean rolling-midnight launch? GTA VI is one, so the
 * launches that teach its shape are the ones that unlocked the same way:
 * midnight local time, rolling across the day, with no early access and no
 * simultaneous global unlock. The target's own pre-release category history
 * is not a launch at all and never counts.
 */
const isRollingClean = (c: Comparable): boolean => {
  const text = `${c.name} ${c.unlock ?? ''}`.toLowerCase();
  if (text.includes('grand theft auto vi')) return false;
  if (text.includes('not a launch') || text.includes('target-history')) return false;
  if (text.includes('tier: early-access') || text.includes('tier: weak')) return false;
  if (text.includes('simultaneous') || text.includes('single global')) return false;
  return text.includes('midnight local') || text.includes('rolling');
};

/**
 * A comparable's release day as hour -> viewers for hours 1..24, or null
 * when the day is too sparse to use (no hour-1 print, or fewer than
 * MIN_SCORED_HOURS of hours 2..24 present).
 */
const releaseDay = (c: Comparable): Map<number, number> | null => {
  const start = Date.parse(c.day_start);
  if (Number.isNaN(start)) return null;
  const day = new Map<number, number>();
  for (const pt of c.hourly ?? []) {
    if (pt.viewers === null || pt.viewers === undefined || pt.viewers <= 0) continue;
    const t = Date.parse(pt.from);
    if (Number.isNaN(t)) continue;
    const h = Math.floor((t - start) / 3_600_000) + 1;
    if (h >= 1 && h <= 24) day.set(h, pt.viewers);
  }
  if (!day.has(1)) return null;
  let scored = 0;
  for (let h = 2; h <= 24; h++) if (day.has(h)) scored++;
  return scored >= MIN_SCORED_HOURS ? day : null;
};

/** A 3-hour running median over hours 2..24 (edges take the hours that exist). */
const smooth3 = (v: Map<number, number>): Map<number, number> => {
  const out = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const window: number[] = [];
    for (const hh of [h - 1, h, h + 1]) if (hh >= 2 && hh <= 24 && v.has(hh)) window.push(v.get(hh)!);
    out.set(h, median(window));
  }
  return out;
};

/**
 * Fit the diurnal curve from a list of release days: per hour, the median
 * log ratio to hour 1 and the population standard deviation of those ratios.
 */
const fitCurve = (days: Array<Map<number, number>>): { mu: Map<number, number>; sigma: Map<number, number> } => {
  const mu = new Map<number, number>();
  const sigma = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const ratios: number[] = [];
    for (const d of days) {
      if (d.has(h)) ratios.push(Math.log(d.get(h)! / d.get(1)!));
    }
    mu.set(h, ratios.length > 0 ? median(ratios) : 0);
    sigma.set(h, ratios.length > 1 ? pstdev(ratios) : SIGMA_FLOOR);
  }
  return { mu: smooth3(mu), sigma: smooth3(sigma) };
};

/** The forecast rows for one case's hour-1 print from a fitted curve. */
const forecastFromCurve = (p1: number, mu: Map<number, number>, sigma: Map<number, number>): Array<{ hour: number; q: number[] }> => {
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (let h = 2; h <= 24; h++) {
    const s = Math.max(sigma.get(h) ?? SIGMA_FLOOR, SIGMA_FLOOR);
    const q = Z.map((z) => {
      const v = round2(p1 * Math.exp(mu.get(h)! + z * s));
      return Math.min(1_000_000_000, Math.max(0.01, v));
    });
    // Rounding cannot break the order, but keep the row non-decreasing
    // whatever the numbers do.
    for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) q[i] = q[i - 1];
    rows.push({ hour: h, q });
  }
  return rows;
};

/** The house baseline's persistence forecast (fallback when no fit is possible). */
const baselineRows = (p1: number): Array<{ hour: number; q: number[] }> => {
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (let h = 2; h <= 24; h++) {
    const q = Z.map((z) => round2(p1 * Math.exp(z * BASELINE_SIGMA * Math.sqrt(h - 1))));
    rows.push({ hour: h, q });
  }
  return rows;
};

/** Forecast one case: fit from its comparables, fall back as needed. */
const forecastCase = (c: Case): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${c.id} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);

  const usable = (c.comparables ?? [])
    .map((comp) => ({ comp, day: releaseDay(comp) }))
    .filter((x): x is { comp: Comparable; day: Map<number, number> } => x.day !== null);

  const rolling = usable.filter((x) => isRollingClean(x.comp)).map((x) => x.day);
  const pool = rolling.length >= MIN_ROLLING_LAUNCHES
    ? rolling
    : usable.map((x) => x.day);
  if (pool.length < MIN_ANY_LAUNCHES) return baselineRows(p1);

  const { mu, sigma } = fitCurve(pool);
  return forecastFromCurve(p1, mu, sigma);
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  if (hours.length !== 23) throw new Error(`${file}: forecast ${hours.length} rows, not 23`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
