// Standard base32 geohash encoder. Precision is a string length, so stepping
// down precision (e.g. 5 → 4 → 3) for a fallback lookup is just a slice —
// geohash prefixes are hierarchical by construction.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lon: number, precision = 5): string {
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch |= (1 << (4 - bit)); lonMin = mid; } else { lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch |= (1 << (4 - bit)); latMin = mid; } else { latMax = mid; }
    }
    evenBit = !evenBit;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function geohashPrecisionSteps(hash: string, from = 5, to = 3): string[] {
  const steps: string[] = [];
  for (let p = from; p >= to; p--) {
    steps.push(hash.slice(0, p));
  }
  return steps;
}
