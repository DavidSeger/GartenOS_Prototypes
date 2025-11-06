import React from 'react';
import * as Location from 'expo-location';

export type Corner = { latitude: number; longitude: number; timestamp: number };
export type XY = { x: number; y: number };

const EARTH_RADIUS_M = 6_378_137;

export function toMetersProjector(lat0: number, lon0: number) {
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY(lat: number, lon: number): XY {
      const x = (lon - lon0) * (Math.PI / 180) * EARTH_RADIUS_M * cos;
      const y = (lat - lat0) * (Math.PI / 180) * EARTH_RADIUS_M;
      return { x, y };
    },
    toLatLon(x: number, y: number) {
      const lat = lat0 + (y / EARTH_RADIUS_M) * (180 / Math.PI);
      const lon = lon0 + (x / (EARTH_RADIUS_M * cos)) * (180 / Math.PI);
      return { lat, lon };
    },
  };
}

/** Douglas–Peucker simplify to drop duplicate/near points in meters */
export function simplifyXY(points: XY[], eps = 0.03): XY[] {
  if (points.length <= 2) return points;
  const lineDist = (p: XY, a: XY, b: XY) => {
    const A = b.y - a.y;
    const B = a.x - b.x;
    const C = -(A * a.x + B * a.y);
    return Math.abs(A * p.x + B * p.y + C) / Math.hypot(A, B);
  };
  let dmax = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDist(points[i], points[0], points[points.length - 1]);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax > eps) {
    const r1 = simplifyXY(points.slice(0, idx + 1), eps);
    const r2 = simplifyXY(points.slice(idx), eps);
    return r1.slice(0, -1).concat(r2);
  }
  return [points[0], points[points.length - 1]];
}

export function polygonAreaMeters(xys: XY[]) {
  if (xys.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < xys.length; i++) {
    const a = xys[i];
    const b = xys[(i + 1) % xys.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function edgeLengthsMeters(xys: XY[]) {
  const arr: number[] = [];
  for (let i = 0; i < xys.length; i++) {
    const a = xys[i];
    const b = xys[(i + 1) % xys.length];
    arr.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return arr;
}

export function formatMeters(m: number) {
  if (m < 1) return `${Math.round(m * 100)} cm`;
  if (m < 10) return `${m.toFixed(2)} m`;
  return `${m.toFixed(1)} m`;
}

export async function ensureLocationReady(): Promise<void> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    throw new Error('Location permission denied. Enable it in Settings.');
  }
  if (Location.hasServicesEnabledAsync) {
    const on = await Location.hasServicesEnabledAsync();
    if (!on) {
      throw new Error('Location services appear off - enable GPS.');
    }
  }
}

function makeLocalProjector(lat0: number, lon0: number) {
  // rough meters/deg at that latitude
  const mPerDegLat = 111132; // good enough here
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY(lat: number, lon: number) {
      return {
        x: (lon - lon0) * mPerDegLon,
        y: (lat - lat0) * mPerDegLat,
      };
    },
    toLatLon(x: number, y: number) {
      return {
        latitude: lat0 + y / mPerDegLat,
        longitude: lon0 + x / mPerDegLon,
      };
    },
  };
}

export async function averageCorner(seconds = 10): Promise<Corner | null> {
  await ensureLocationReady();

  const samples: { lat: number; lon: number; acc: number }[] = [];
  const t0 = Date.now();
  let sub: Location.LocationSubscription | null = null;

  try {
    sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 100,
          distanceInterval: 0,
          mayShowUserSettingsDialog: true,
        },
        (pos) => {
          const acc = pos.coords.accuracy ?? 9999;
          const { latitude: lat, longitude: lon } = pos.coords;

          // keep only decent fixes
          if (Number.isFinite(lat) && Number.isFinite(lon) && acc <= 5) {
            samples.push({ lat, lon, acc });
          }

          // stop collecting when time is up
          if (Date.now() - t0 >= seconds * 1000) {
            sub?.remove();
            sub = null;
          }
        }
    );

    // wait until time is up
    while (Date.now() - t0 < seconds * 1000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    // make sure it’s really stopped
    sub?.remove();
  }

  // not enough good data
  if (samples.length < 3) return null;

  // use first sample as local origin
  const origin = samples[0];
  const proj = makeLocalProjector(origin.lat, origin.lon);

  let wSum = 0;
  let xSum = 0;
  let ySum = 0;

  for (const s of samples) {
    const sigma = Math.max(1, s.acc); // avoid div by 0
    const w = 1 / (sigma * sigma);
    const { x, y } = proj.toXY(s.lat, s.lon);
    wSum += w;
    xSum += w * x;
    ySum += w * y;
  }

  const xAvg = xSum / wSum;
  const yAvg = ySum / wSum;
  const { latitude, longitude } = proj.toLatLon(xAvg, yAvg);

  return {
    latitude,
    longitude,
    timestamp: Date.now(),
  };
}

export function useMetrics(corners: Corner[]) {
  return React.useMemo(() => {
    if (corners.length < 2) return null;
    const lat0 = corners[0].latitude;
    const lon0 = corners[0].longitude;
    const proj = toMetersProjector(lat0, lon0);
    const rawXY: XY[] = corners.map((c) => proj.toXY(c.latitude, c.longitude));
    const closed =
      rawXY.length > 2 &&
      Math.hypot(rawXY[0].x - rawXY[rawXY.length - 1].x, rawXY[0].y - rawXY[rawXY.length - 1].y) < 0.05;
    const pts = closed ? rawXY.slice(0, -1) : rawXY;
    const simp = simplifyXY(pts, 0.02);
    const perim = edgeLengthsMeters(simp).reduce((a, b) => a + b, 0);
    const area = simp.length >= 3 ? polygonAreaMeters(simp) : 0;
    return { proj, xy: simp, perim, area, closed };
  }, [corners]);
}

export type CornerMetrics = ReturnType<typeof useMetrics>;
