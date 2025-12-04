import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import type { ObjectPlannerContext, PlannerSuggestion } from '../services/objectPlannerService.ts';

// Load env (prefers .env.local, falls back to .env)
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const FALLBACK_OPENAI_KEY =
  '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';

if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
  process.env.EXPO_PUBLIC_OPENAI_API_KEY = FALLBACK_OPENAI_KEY;
}

const DEFAULT_FIXTURE = path.resolve(__dirname, '../Testing/garden-session-test.json');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../Testing/replay-expert-output.json');

type LatLng = { lat: number; lng: number };
type XY = { x: number; y: number };

function loadContext(filePath: string): ObjectPlannerContext {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const layout = raw.cornerDrawing ?? raw.layout;
  if (!layout?.points?.length) {
    throw new Error('cornerDrawing/layout points missing in fixture.');
  }

  const existingAnnotations = Array.isArray(raw.existingAnnotations)
    ? raw.existingAnnotations
    : Array.isArray(raw.annotations)
      ? raw.annotations
      : [];
  const existingZones = Array.isArray(raw.existingZones)
    ? raw.existingZones
    : Array.isArray(raw.zones)
      ? raw.zones
      : [];

  return {
    layout,
    corners: Array.isArray(raw.corners) ? raw.corners : [],
    transcriptSegments: Array.isArray(raw.transcriptSegments) ? raw.transcriptSegments : [],
    headings: Array.isArray(raw.headings) ? raw.headings : [],
    existingAnnotations,
    existingZones,
    surface: typeof raw.surface === 'string' ? raw.surface : undefined,
  };
}

function toMetersProjector(lat0: number, lon0: number) {
  const EARTH_RADIUS_M = 6_378_137;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY(lat: number, lon: number): XY {
      const x = (lon - lon0) * (Math.PI / 180) * EARTH_RADIUS_M * cos;
      const y = (lat - lat0) * (Math.PI / 180) * EARTH_RADIUS_M;
      return { x, y };
    },
    toLatLon(x: number, y: number): { lat: number; lon: number } {
      const lat = lat0 + (y / EARTH_RADIUS_M) * (180 / Math.PI);
      const lon = lon0 + (x / (EARTH_RADIUS_M * cos)) * (180 / Math.PI);
      return { lat, lon };
    },
  };
}

function buildLayoutToLatLng(
  layout: ObjectPlannerContext['layout'],
  corners: ObjectPlannerContext['corners'],
): ((pt: XY | null | undefined) => LatLng | null) | null {
  if (!layout?.points?.length || !corners?.length) {
    return null;
  }
  const lat0 = corners[0]?.latitude;
  const lon0 = corners[0]?.longitude;
  const scale = layout.scale ?? 1;
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  const padding = layout.extent?.padding ?? 16;
  const proj = toMetersProjector(lat0, lon0);
  const xy = corners
    .map((corner) => proj.toXY(corner.latitude, corner.longitude))
    .filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
  if (!xy.length) {
    return null;
  }
  const isClosed =
    (layout.closed ?? true) &&
    xy.length > 2 &&
    Math.hypot(xy[0].x - xy[xy.length - 1].x, xy[0].y - xy[xy.length - 1].y) < 0.05;
  const pts = isClosed ? xy.slice(0, -1) : xy;
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));

  return (pt) => {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return null;
    }
    const xMeters = (pt.x - padding) * scale + minX;
    const yMeters = (pt.y - padding) * scale + minY;
    const { lat, lon } = proj.toLatLon(xMeters, yMeters);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return { lat: Number(lat.toFixed(8)), lng: Number(lon.toFixed(8)) };
  };
}

function buildExpertPayload(
  context: ObjectPlannerContext,
  suggestion: PlannerSuggestion,
  fixturePath: string,
) {
  const toLatLng = buildLayoutToLatLng(context.layout, context.corners);
  const surface = suggestion.surface ?? context.surface ?? 'grass';

  const boundaryPoints: LatLng[] = (context.corners ?? [])
    .map((corner) => {
      const lat = Number(corner?.latitude);
      const lon = Number(corner?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }
      return { lat: Number(lat.toFixed(8)), lng: Number(lon.toFixed(8)) };
    })
    .filter((pt): pt is LatLng => Boolean(pt));

  const annotations = Array.isArray(suggestion.annotations)
    ? suggestion.annotations
        .map((ann) => {
          const latlng = toLatLng ? toLatLng({ x: ann.x, y: ann.y }) : null;
          if (!latlng) {
            return null;
          }
          return {
            id: ann.id,
            type: ann.type,
            size: ann.size,
            latlng,
          };
        })
        .filter(
          (
            ann,
          ): ann is {
            id?: string;
            type: string;
            size?: string;
            latlng: LatLng;
          } => Boolean(ann),
        )
    : [];

  const zones = Array.isArray(suggestion.zones)
    ? suggestion.zones
        .map((zone) => {
          const pts =
            toLatLng && Array.isArray(zone.points)
              ? zone.points
                  .map((pt) => toLatLng(pt))
                  .filter((pt): pt is LatLng => Boolean(pt))
              : [];
          if (pts.length < 3) {
            return null;
          }
          return {
            id: zone.id,
            type: zone.type,
            points: pts,
          };
        })
        .filter((zone): zone is { id?: string; type: string; points: LatLng[] } => Boolean(zone))
    : [];

  return {
    points: boundaryPoints,
    closed: Boolean(context.layout?.closed ?? true),
    surface,
    unit: 'm',
    calibratedEdgeIndex: null,
    correctionFactor: 1,
    annotations,
    zones,
    _meta: {
      ts: Date.now(),
      source: 'replayObjectPlanner',
      fixture: path.basename(fixturePath),
      latLngTransform: Boolean(toLatLng),
    },
    _debug: {
      fixturePath,
      cornerDrawing: context.layout,
      annotationsPlanar: suggestion.annotations,
      zonesPlanar: suggestion.zones,
    },
  };
}

async function main() {
  const { suggestGardenPlanWithChatGPT } = await import('../services/objectPlannerService.ts');

  const fixturePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FIXTURE;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;
  console.log(`[1/5] Using fixture: ${fixturePath}`);

  const context = loadContext(fixturePath);
  console.log(`[2/5] Layout points: ${context.layout.points.length}`);
  console.log(`[3/5] Transcript segments: ${context.transcriptSegments.length}`);
  console.log(`[4/5] Output file: ${outputPath}`);
  console.log('[5/5] Calling ChatGPT with production prompt/schema...');

  const result = await suggestGardenPlanWithChatGPT(context);
  const output = {
    annotations: result.annotations,
    zones: result.zones,
    surface: result.surface,
  };

  const expertPayload = buildExpertPayload(context, result, fixturePath);

  if (!expertPayload._meta.latLngTransform) {
    console.warn('Warning: could not derive lat/lng transform; export will include only boundary points.');
  }

  try {
    fs.writeFileSync(outputPath, JSON.stringify(expertPayload, null, 2));
    console.log(`\nSaved expert-view JSON to: ${outputPath}`);
  } catch (error) {
    console.error('Unable to write expert-view JSON:', error);
  }

  console.log('\n--- ChatGPT JSON (for comparison) ---');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('Replay failed:', err);
  process.exit(1);
});
