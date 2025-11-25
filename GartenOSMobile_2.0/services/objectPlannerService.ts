import { TranscriptSegment } from './geminiService.ts';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_API_URL =
  process.env.EXPO_PUBLIC_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o-mini';
const BASE_SYSTEM_PROMPT =
  'You are GartenOS, a meticulous landscape assistant for a garden biodiversity app. ' +
  'You receive a FIXED garden JSON map (polygon, scale, extent, existing annotations/zones),' +
  ' a timestamped walkthrough transcript, and possibly timestamped heading/orientation and GPS data. ' +
  '' +
  'Your ONLY job is to suggest NEW object placements (trees, shrubs, water, beds, structures) as map coordinates' +
  ' and append them to the existing annotations according to the provided schema. ' +
  'In addition, identify any described ground surfaces or subzones (soil beds, patios, lawns, concrete pads, etc.) ' +
  'and return them under zones[] using polygons that sit fully inside the garden. ' +
  '' +
  'Non-negotiable restraints: ' +
  '- Never alter the garden polygon or its points. ' +
  '- Never alter scale, extent, unit, or calibratedEdgeIndex. ' +
  '- Never delete, rename, or rewrite existing annotations or zones unless explicitly instructed during edit mode. ' +
  '- Never normalize or reorder unrelated parts of the JSON. ' +
  '- Output must be valid JSON conforming exactly to the provided schema. ' +
  '- Always make sure that object IDs in the JSON are unique, no duplicate identifiers. ' +
  '' +
  'Subzone + surface logic: ' +
  '- When the entire garden surface is described ("the garden ground is made of grass"), set the root-level `surface`. ' +
  '- When the narrator describes local materials (soil patch, concrete patio, grass in one corner), create a zone polygon under zones[]. ' +
  '- Each zone polygon must have at least three points with coordinates in the same space as layout.points, always inside the main polygon. ' +
  '- Keep zone types literal (soil, grass, gravel, mulch, concrete, etc.) unless an obvious synonym is required. ' +
  '- Use described dimensions and relative positions to size/locate polygons; if measurements are missing, infer approximate proportions but stay within the polygon. ' +
  '- Convert spoken dimensions (e.g., "3 by 5 meters") into polygon width/height aligned with the mentioned edge or reference point whenever possible. ' +
  '- Never omit a described surface/walkway/patio: if the transcript mentions it, you MUST add a zone approximating its footprint, even if it requires reasonable estimation. ' +
  '' +
  'Placement logic (very important): ' +
  '1) Treat the transcript as a sequence of segments tied to time. Whenever the narrator says things like "now we are at this edge", "now I am here", or when heading changes strongly, start a NEW edge segment. ' +
  '2) For each segment where trees/objects are mentioned "along the edge" or "to the left/right while walking", you MUST first decide which polygon edge the user is likely walking along. ' +
  '3) To decide the edge, compare the current heading/orientation to the bearing of each polygon edge (edge = line between two consecutive polygon/cornerDrawing points) and pick the edge whose direction is closest to the heading at that timestamp. ' +
  '4) Once an edge is selected, place the mentioned objects ON THAT EDGE by interpolating positions between the two edge endpoints. Do NOT place them on an arbitrary horizontal or vertical line. Do NOT place them outside the polygon. ' +
  '5) If the transcript says "three trees in equal distance", distribute exactly three points evenly along the chosen edge segment. ' +
  '6) If the transcript later says "on the longer edge four trees", treat that as a NEW edge with its own distribution -- do NOT continue the previous line. ' +
  '7) If you cannot unambiguously map a transcript segment to a polygon edge, set the annotation with an "uncertain": true (if schema allows) and do NOT fall back to a made-up straight line. ' +
  '' +
  'Directional inference: ' +
  '- Phrases like "to the left of me" / "to the right of me" must be resolved relative' +
  ' to the heading at that second. ' +
  '- If the user is walking along an edge, "to the left" usually means inside or on the boundary of the polygon;' +
  ' prefer coordinates just inside or on the edge. ' +
  '- If heading data is sparse, interpolate from the nearest timestamps. ' +
  '' +
  'Handling summary statements: ' +
  '- If the transcript later summarizes ("we have 12 trees on three edges"), do NOT re-create or move previously' +
  ' placed trees. Treat summaries as validation, not as new placement instructions. ' +
  '- Never place more objects on one edge than the transcript indicates for that edge. ' +
  '' +
  'GPS / extra data: ' +
  '- If GPS points or cornerDrawing are present, treat them as higher-authority geometry than the natural-language description. ' +
  '- When GPS timestamps overlap transcript timestamps, align them by time and use the nearest GPS point to locate the user along the polygon at that moment. ' +
  '- Snap to polygon edges derived from cornerDrawing.points whenever possible. ' +
  '' +
  'After producing the JSON, you MAY (if the caller accepts extra fields) add a small "meta" or ' +
  '"accuracy_suggestions" field describing what extra data (denser headings, spoken distances, ' +
  'photos at key timestamps) would reduce ambiguity. ' +
  'If the schema does NOT allow extra fields, only return the updated JSON without suggestions. ' +
  '' +
  'Output discipline: ' +
  '- Primary output is the updated JSON map with newly appended annotations. ' +
  '- Preserve all existing fields and values exactly. ' +
  '- Do NOT explain before the JSON. ';

export type HeadingSample = { second: number; heading_deg: number };

export type GardenLayoutSummary = {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
  scale: number;
  extent?: {
    width?: number;
    height?: number;
    padding?: number;
  };
};

export type GardenAnnotation = {
  id?: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  confidence?: number;
};

export type GardenZone = {
  id?: string;
  type: string;
  points: Array<{ x: number; y: number }>;
  label?: string;
  confidence?: number;
};

export type PlannerSuggestion = {
  annotations: GardenAnnotation[];
  zones: GardenZone[];
  surface?: string;
};

export type ObjectPlannerContext = {
  layout: GardenLayoutSummary;
  corners: Array<{ latitude: number; longitude: number }>;
  transcriptSegments: TranscriptSegment[];
  headings: HeadingSample[];
  existingAnnotations?: GardenAnnotation[];
  existingZones?: GardenZone[];
  surface?: string;
};

type PlannerResponse = {
  objects: Array<{
    type: string;
    x: number;
    y: number;
    label?: string;
    confidence?: number;
  }>;
  zones?: Array<{
    type: string;
    points: Array<{
      x: number;
      y: number;
    }>;
    label?: string;
    confidence?: number;
  }>;
  surface?: string;
};

async function runPlannerCompletion(
  systemPrompt: string,
  userText: string,
  instructions: Record<string, unknown>,
): Promise<PlannerResponse> {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'garden_annotations',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['objects', 'zones'],
            properties: {
              objects: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'x', 'y'],
                  properties: {
                    type: { type: 'string' },
                    label: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
              zones: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'points'],
                  properties: {
                    type: { type: 'string' },
                    label: { type: 'string' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    points: {
                      type: 'array',
                      minItems: 3,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['x', 'y'],
                        properties: {
                          x: { type: 'number' },
                          y: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
              surface: { type: 'string' },
            },
          },
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'text', text: JSON.stringify(instructions) },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ChatGPT placement failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('ChatGPT returned an empty response.');
  }

  try {
    return JSON.parse(content) as PlannerResponse;
  } catch (error) {
    throw new Error(`Unable to parse ChatGPT response: ${(error as Error).message}`);
  }
}

export async function suggestGardenPlanWithChatGPT(
  context: ObjectPlannerContext,
): Promise<PlannerSuggestion> {
  if (!OPENAI_API_KEY) {
    throw new Error('EXPO_PUBLIC_OPENAI_API_KEY is not configured.');
  }

  if (!context.layout?.points?.length) {
    return { annotations: [], zones: [], surface: context.surface };
  }

  const instructions = {
    layout: context.layout,
    corners: context.corners.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    existingAnnotations: context.existingAnnotations ?? [],
    existingZones: context.existingZones ?? [],
    transcriptSegments: context.transcriptSegments,
    headings: context.headings,
    surface: context.surface,
  };

  const parsed = await runPlannerCompletion(
    BASE_SYSTEM_PROMPT,
    'Add trees/shrubs/water features plus any described ground subzones or surfaces from the transcript. ' +
      'Whenever the transcript mentions a surface material (grass, soil, gravel, mulch, concrete, pathway, patio, field, etc.) for a specific area, you MUST emit a polygon entry in zones[] representing that area. ' +
      'If the entire garden ground material is given, set the root-level surface string. ' +
      'Use headings to infer relative direction. ' +
      'Return JSON with only the proposed objects (objects[]), newly described zones (zones[]), and optional surface. ' +
      'Coordinates use the same space as layout.points.',
    instructions,
  );

  return {
    annotations: normalizePlannerObjects(parsed.objects, 'ai'),
    zones: normalizePlannerZones(parsed.zones, 'ai'),
    surface: parsed.surface?.trim() || context.surface,
  };
}

export async function suggestAnnotationsWithChatGPT(
  context: ObjectPlannerContext,
): Promise<GardenAnnotation[]> {
  const plan = await suggestGardenPlanWithChatGPT(context);
  return plan.annotations;
}

export async function editGardenPlanWithChatGPT(
  context: ObjectPlannerContext,
  editTranscript: string,
): Promise<PlannerSuggestion> {
  if (!OPENAI_API_KEY) {
    throw new Error('EXPO_PUBLIC_OPENAI_API_KEY is not configured.');
  }
  if (!context.layout?.points?.length) {
    return {
      annotations: context.existingAnnotations ?? [],
      zones: context.existingZones ?? [],
      surface: context.surface,
    };
  }
  if (!editTranscript?.trim()) {
    return {
      annotations: context.existingAnnotations ?? [],
      zones: context.existingZones ?? [],
      surface: context.surface,
    };
  }

  const editPrompt =
    BASE_SYSTEM_PROMPT +
    ' You are now editing existing annotations and zones. Apply ONLY the requested changes from editTranscript. ' +
    'You may move, delete, or add annotations/zones or adjust the surface when explicitly asked. ' +
    'Return the FULL updated annotations and zones arrays.';

  const instructions = {
    layout: context.layout,
    corners: context.corners.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    existingAnnotations: context.existingAnnotations ?? [],
    existingZones: context.existingZones ?? [],
    transcriptSegments: context.transcriptSegments,
    headings: context.headings,
    editTranscript,
    surface: context.surface,
  };

  const parsed = await runPlannerCompletion(
    editPrompt,
    'Apply editTranscript to the existing annotations/zones. Only change placements explicitly mentioned. ' +
      'If the edit describes ground materials, make sure the corresponding zones[] entries or surface value are updated. ' +
      'Return the full annotations array (objects[]) and zones[] after edits.',
    instructions,
  );

  const annotations = normalizePlannerObjects(parsed.objects, 'ai_edit');
  const zones = normalizePlannerZones(parsed.zones, 'ai_edit');

  return {
    annotations: annotations.length ? annotations : context.existingAnnotations ?? [],
    zones: zones.length ? zones : context.existingZones ?? [],
    surface: parsed.surface?.trim() || context.surface,
  };
}

export async function editAnnotationsWithChatGPT(
  context: ObjectPlannerContext,
  editTranscript: string,
): Promise<GardenAnnotation[]> {
  const plan = await editGardenPlanWithChatGPT(context, editTranscript);
  return plan.annotations;
}

function normalizePlannerObjects(
  objects?: PlannerResponse['objects'],
  idPrefix = 'ai',
): GardenAnnotation[] {
  if (!Array.isArray(objects)) {
    return [];
  }
  const usedIds = new Set<string>();
  return objects
    .map((obj, index) => {
      const x = Number(obj?.x);
      const y = Number(obj?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      const fallbackId = `${idPrefix}_${index}_${randomId()}`;
      const baseId = obj?.label ? normalizeId(obj.label) : fallbackId;
      const id = ensureUniqueId(baseId, usedIds, fallbackId);
      return {
        id,
        type: obj?.type?.trim() || 'unknown',
        x,
        y,
        label: obj?.label?.trim(),
        confidence: obj?.confidence,
      };
    })
    .filter((obj): obj is GardenAnnotation => Boolean(obj));
}

function normalizePlannerZones(
  zones?: PlannerResponse['zones'],
  idPrefix = 'ai',
): GardenZone[] {
  if (!Array.isArray(zones)) {
    return [];
  }
  const usedIds = new Set<string>();
  return zones
    .map((zone, index) => {
      const points = (zone?.points ?? [])
        .map((point) => {
          const x = Number(point?.x);
          const y = Number(point?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
          }
          return { x, y };
        })
        .filter((pt): pt is { x: number; y: number } => Boolean(pt));

      const type = zone?.type?.trim();
      if (!type || points.length < 3) {
        return null;
      }
      const fallbackId = `${idPrefix}_zone_${index}_${randomId()}`;
      const baseId = zone?.label ? normalizeZoneId(zone.label) : fallbackId;
      const id = ensureUniqueId(baseId, usedIds, fallbackId);
      return {
        id,
        type,
        label: zone?.label?.trim(),
        confidence: zone?.confidence,
        points,
      };
    })
    .filter((zone): zone is GardenZone => Boolean(zone));
}

function normalizeZoneId(label: string) {
  const normalized = normalizeId(label);
  return normalized.startsWith('zone-') ? normalized : `zone-${normalized}`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 9);
}

function normalizeId(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || `ai_${randomId()}`
  );
}

function ensureUniqueId(baseId: string, used: Set<string>, fallback: string) {
  let candidate = baseId?.trim() || fallback;
  if (!candidate) {
    candidate = fallback;
  }
  let suffix = 1;
  let uniqueId = candidate;
  while (used.has(uniqueId)) {
    uniqueId = `${candidate}-${suffix}`;
    suffix += 1;
  }
  used.add(uniqueId);
  return uniqueId;
}
