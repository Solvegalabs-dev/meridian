// Meeus algorithm — "Astronomical Algorithms" ch. 49

const SYNODIC_MONTH = 29.53058867;
// Known new moon: 2000-01-06 18:14 UTC
const KNOWN_NEW_MOON_JD = 2451550.1;

function julianDate(date: Date): number {
  let Y = date.getUTCFullYear();
  let M = date.getUTCMonth() + 1;
  const D =
    date.getUTCDate() +
    date.getUTCHours() / 24 +
    date.getUTCMinutes() / 1440 +
    date.getUTCSeconds() / 86400;

  if (M <= 2) {
    Y -= 1;
    M += 12;
  }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
}

function phaseName(ageDays: number): string {
  if (ageDays < 1.85)  return 'New Moon';
  if (ageDays < 7.38)  return 'Waxing Crescent';
  if (ageDays < 9.22)  return 'First Quarter';
  if (ageDays < 14.77) return 'Waxing Gibbous';
  if (ageDays < 16.61) return 'Full Moon';
  if (ageDays < 22.15) return 'Waning Gibbous';
  if (ageDays < 23.99) return 'Last Quarter';
  return 'Waning Crescent';
}

export function getMoonPhase(date: Date): {
  phase: number;        // 0–1 (0=new, 0.5=full)
  phaseName: string;
  illumination: number; // 0–100%
  daysToFull: number;
} {
  const jd = julianDate(date);
  const daysSinceNew = jd - KNOWN_NEW_MOON_JD;
  const ageDays = ((daysSinceNew % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;

  const phase = ageDays / SYNODIC_MONTH;
  const illumination = 50 * (1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_MONTH));
  const fullMoonAge = SYNODIC_MONTH / 2;
  const daysToFull = ageDays <= fullMoonAge
    ? fullMoonAge - ageDays
    : SYNODIC_MONTH + fullMoonAge - ageDays;

  return {
    phase: Math.round(phase * 10000) / 10000,
    phaseName: phaseName(ageDays),
    illumination: Math.round(illumination * 10) / 10,
    daysToFull: Math.round(daysToFull * 10) / 10,
  };
}
