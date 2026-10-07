import { EnvironmentalError } from './contracts.js';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

export function assertTimeZone(timeZone: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(0); }
  catch { throw new EnvironmentalError('ENVIRONMENTAL_LOCATION_INVALID', 'The time zone is not a known IANA zone'); }
}

const clocks = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock text `YYYY-MM-DDTHH:MM:SS` for a UTC instant in an IANA zone. */
function wallClock(ms: number, timeZone: string) {
  let f = clocks.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); clocks.set(timeZone, f); }
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Local civil time in `timeZone` → the unique UTC instant. A DST gap (no instant) or fold (two) is rejected, never guessed. */
export function localToUtc(localDateTime: string, timeZone: string): number {
  const [date, time] = localDateTime.split('T') as [string, string];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number], [h, mi, s = 0] = time.split(':').map(Number) as [number, number, number?];
  const naive = Date.UTC(y, mo - 1, d, h, mi, s), target = `${date}T${time.length === 5 ? `${time}:00` : time}`;
  if (y < 1900 || y > 2100 || new Date(naive).toISOString().slice(0, 19) !== target)
    throw new EnvironmentalError('ENVIRONMENTAL_INPUT_INCOMPLETE', 'Solar instants need a valid local date-time between 1900 and 2100');
  const offset = (ms: number) => Date.parse(`${wallClock(ms, timeZone)}Z`) - ms;
  const hits = [...new Set([naive - offset(naive - 86_400_000), naive - offset(naive), naive - offset(naive + 86_400_000)])].filter(t => wallClock(t, timeZone) === target);
  if (hits.length !== 1) throw new EnvironmentalError('ENVIRONMENTAL_INPUT_INCOMPLETE', hits.length ? 'The local time is ambiguous (daylight-saving fold)' : 'The local time does not exist (daylight-saving gap)');
  return hits[0]!;
}

/**
 * NOAA_MEEUS_GEOMETRIC_V1 — NOAA Solar Calculator form of Meeus' low-precision solar coordinates.
 * Geometric (no refraction), geocentric; UT is used for TT. Azimuth clockwise from geographic north; altitude above the horizon.
 */
export function solarPosition(utcMs: number, latitudeDeg: number, longitudeDeg: number) {
  const jd = utcMs / 86_400_000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = wrap(280.46646 + T * (36000.76983 + 0.0003032 * T)), M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T, lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eqTimeMin = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutesUtc = ((utcMs % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;
  const trueSolarMin = ((minutesUtc + eqTimeMin + 4 * longitudeDeg) % 1440 + 1440) % 1440, hourAngle = trueSolarMin / 4 - 180;
  const phi = latitudeDeg * RAD, dec = declination * RAD, H = hourAngle * RAD;
  const cosZenith = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)));
  const azimuth = wrap(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * DEG + 180);
  return { altitude: 90 - Math.acos(cosZenith) * DEG, azimuth, declination, equationOfTimeMinutes: eqTimeMin };
}

/** Model-frame north/east for NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X; east = north × up, so the frame stays right-handed. */
export function compass(northMilliDegrees: number) {
  const t = northMilliDegrees / 1000 * RAD;
  return { north: [Math.sin(t), 0, -Math.cos(t)] as [number, number, number], east: [Math.cos(t), 0, Math.sin(t)] as [number, number, number] };
}
/** Unit vector toward the sun in the model frame. */
export function sunVector(altitudeDeg: number, azimuthDeg: number, frame: { north: number[]; east: number[] }): [number, number, number] {
  const a = altitudeDeg * RAD, z = azimuthDeg * RAD, h = Math.cos(a);
  return [h * (Math.cos(z) * frame.north[0]! + Math.sin(z) * frame.east[0]!), Math.sin(a), h * (Math.cos(z) * frame.north[2]! + Math.sin(z) * frame.east[2]!)];
}
