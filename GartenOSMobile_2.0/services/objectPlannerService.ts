import { TranscriptSegment } from './geminiService.ts';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_API_URL =
  process.env.EXPO_PUBLIC_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o-mini';
const BASE_SYSTEM_PROMPT =
  'You are GartenOS, a meticulous landscape assistant for a garden biodiversity app. ' +
  'You receive a FIXED garden JSON map (polygon, scale, extent, existing annotations/zones),' +
  ' a timestamped walkthrough transcript, and possibly timestamped heading/orientation and GPS data. ' +
  'You will also receive edges[] with bearings/lengths derived from the polygon and segmentEdgeHints[] that map transcript segments to their most likely edge based on heading. ' +
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
  '3) Use segmentEdgeHints[].candidateEdgeIndex when provided; otherwise compare current heading/orientation to the bearing of each edge in edges[] (edge = line between two consecutive polygon/cornerDrawing points) and pick the closest bearing. ' +
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
  '- Respect northBearing if provided to avoid flipping left/right. ' +
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

export type EdgeMetadata = {
  index: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  bearing_deg: number;
  length: number;
};

export type SegmentEdgeHint = {
  segmentIndex: number;
  start_s: number;
  heading_deg: number | null;
  candidateEdgeIndex: number | null;
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
    edges: buildEdgeMetadata(context.layout?.points ?? [], context.layout?.closed ?? true),
    segmentEdgeHints: buildSegmentEdgeHints(context.transcriptSegments, context.headings, context.layout),
    northBearing: estimateNorthBearing(context.layout?.points ?? []),
  };

  const parsed = await runPlannerCompletion(
    BASE_SYSTEM_PROMPT,
    'Add trees/shrubs/water features plus any described ground subzones or surfaces from the transcript. ' +
      'Whenever the transcript mentions a surface material (grass, soil, gravel, mulch, concrete, pathway, patio, field, etc.) for a specific area, you MUST emit a polygon entry in zones[] representing that area. ' +
      'If the entire garden ground material is given, set the root-level surface string. ' +
      'Use headings to infer relative direction. ' +
      'Use edges[] and segmentEdgeHints[] to choose the correct edge; align placements to that edge and keep counts per edge exactly as described. ' +
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
    'Default behavior: move or relabel existing items and reuse their IDs. Do NOT create new annotations or zones unless the edit explicitly requests additions. ' +
    'Keep the count of each array the same unless the edit explicitly says to add or remove items. ' +
    'When the edit refers to items already present (e.g., "the four trees you put there..."), update those items instead of creating new ones. ' +
    'Return the FULL updated annotations and zones arrays, preserving existing IDs whenever possible.';

  const instructions = {
    layout: context.layout,
    corners: context.corners.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    existingAnnotations: context.existingAnnotations ?? [],
    existingZones: context.existingZones ?? [],
    transcriptSegments: context.transcriptSegments,
    headings: context.headings,
    editTranscript,
    surface: context.surface,
    edges: buildEdgeMetadata(context.layout?.points ?? [], context.layout?.closed ?? true),
    segmentEdgeHints: buildSegmentEdgeHints(context.transcriptSegments, context.headings, context.layout),
    northBearing: estimateNorthBearing(context.layout?.points ?? []),
  };

  const parsed = await runPlannerCompletion(
    editPrompt,
    'Apply editTranscript to the existing annotations/zones. Only change placements explicitly mentioned. ' +
      'If the edit describes ground materials, make sure the corresponding zones[] entries or surface value are updated. ' +
      'Do NOT add new annotations/zones unless the edit explicitly requests additions. ' +
      'Use edges[] and segmentEdgeHints[] to keep placements aligned to the correct edges; adjust existing counts rather than adding new items. ' +
      'Reuse existing IDs when moving items. Keep counts unchanged unless additions/removals are clearly requested. ' +
      'Return the full annotations array (objects[]) and zones[] after edits.',
    instructions,
  );

  const annotations = normalizeEditedPlannerObjects(
    parsed.objects,
    context.existingAnnotations ?? [],
    editTranscript,
    'ai_edit',
  );
  const zones = normalizeEditedPlannerZones(parsed.zones, context.existingZones ?? [], editTranscript, 'ai_edit');

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

function normalizeEditedPlannerObjects(
  objects: PlannerResponse['objects'] | undefined,
  existing: GardenAnnotation[],
  editTranscript: string,
  idPrefix = 'ai_edit',
): GardenAnnotation[] {
  const hasAddIntent = /(?:\badd\b|\banother\b|\bextra\b|\badditional\b|\bmore\b|\bnew\b|\bplace another\b|\balso add\b|\balso put\b)/i.test(
    editTranscript ?? '',
  );
  const hasRemoveIntent = /(?:\bremove\b|\bdelete\b|\bdrop\b|\btake(?:\s+.*)?out\b|\berase\b|\bno longer\b)/i.test(
    editTranscript ?? '',
  );

  if (!Array.isArray(objects)) {
    return existing ?? [];
  }

  const usedIds = new Set<string>();
  for (const ann of existing ?? []) {
    if (ann?.id) {
      usedIds.add(ann.id);
    }
  }

  const parsed = objects
    .map((obj) => {
      const x = Number(obj?.x);
      const y = Number(obj?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        type: obj?.type?.trim() || 'unknown',
        label: obj?.label?.trim(),
        confidence: obj?.confidence,
        x,
        y,
      };
    })
    .filter((obj): obj is GardenAnnotation => Boolean(obj));

  const availableIndices = new Set<number>();
  existing?.forEach((_, idx) => availableIndices.add(idx));

  const pickMatchIndex = (candidate: GardenAnnotation): number | null => {
    const candLabel = candidate.label?.trim()?.toLowerCase();
    if (candLabel) {
      for (const idx of availableIndices) {
        const ex = existing[idx];
        const labelMatch = ex?.label?.trim()?.toLowerCase() === candLabel;
        if (labelMatch) {
          return idx;
        }
      }
    }
    for (const idx of availableIndices) {
      const ex = existing[idx];
      if (ex?.type?.trim()?.toLowerCase() === candidate.type?.trim()?.toLowerCase()) {
        return idx;
      }
    }
    return null;
  };

  const normalized: GardenAnnotation[] = [];

  for (const candidate of parsed) {
    const matchIdx = pickMatchIndex(candidate);
    if (matchIdx != null) {
      const matched = existing[matchIdx];
      const id = ensureUniqueId(matched?.id ?? normalizeId(matched?.label ?? ''), usedIds, `${idPrefix}_${matchIdx}`);
      normalized.push({ ...candidate, id });
      availableIndices.delete(matchIdx);
      continue;
    }

    if (!hasAddIntent) {
      if (availableIndices.size > 0) {
        const idx = [...availableIndices][0];
        const matched = existing[idx];
        const id = ensureUniqueId(matched?.id ?? normalizeId(matched?.label ?? ''), usedIds, `${idPrefix}_${idx}`);
        normalized.push({ ...candidate, id });
        availableIndices.delete(idx);
      }
      // If no available existing slot and no add intent, skip the extra candidate.
      continue;
    }

    const fallbackId = `${idPrefix}_${normalized.length}_${randomId()}`;
    const baseId = candidate.label ? normalizeId(candidate.label) : fallbackId;
    const id = ensureUniqueId(baseId, usedIds, fallbackId);
    normalized.push({ ...candidate, id });
  }

  if (!hasRemoveIntent && availableIndices.size > 0) {
    // Keep any leftover existing annotations to preserve count when no removal is requested.
    for (const idx of availableIndices) {
      const ann = existing[idx];
      if (!ann) continue;
      const id = ensureUniqueId(ann.id ?? normalizeId(ann.label ?? ''), usedIds, `${idPrefix}_${idx}`);
      normalized.push({
        id,
        type: ann.type?.trim() || 'unknown',
        label: ann.label?.trim(),
        confidence: ann.confidence,
        x: ann.x,
        y: ann.y,
      });
    }
  }

  return normalized;
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

function normalizeEditedPlannerZones(
  zones: PlannerResponse['zones'] | undefined,
  existing: GardenZone[],
  editTranscript: string,
  idPrefix = 'ai_edit',
): GardenZone[] {
  const hasAddIntent = /(?:\badd\b|\banother\b|\bextra\b|\badditional\b|\bmore\b|\bnew\b|\bplace another\b|\balso add\b|\balso put\b)/i.test(
    editTranscript ?? '',
  );
  const hasRemoveIntent = /(?:\bremove\b|\bdelete\b|\bdrop\b|\btake(?:\s+.*)?out\b|\berase\b|\bno longer\b)/i.test(
    editTranscript ?? '',
  );

  if (!Array.isArray(zones)) {
    return existing ?? [];
  }

  const usedIds = new Set<string>();
  for (const z of existing ?? []) {
    if (z?.id) {
      usedIds.add(z.id);
    }
  }

  const parsed = zones
    .map((zone) => {
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
      return {
        type,
        label: zone?.label?.trim(),
        confidence: zone?.confidence,
        points,
      };
    })
    .filter((zone): zone is GardenZone => Boolean(zone));

  const availableIndices = new Set<number>();
  existing?.forEach((_, idx) => availableIndices.add(idx));

  const pickMatchIndex = (candidate: GardenZone): number | null => {
    const candLabel = candidate.label?.trim()?.toLowerCase();
    if (candLabel) {
      for (const idx of availableIndices) {
        const ex = existing[idx];
        const labelMatch = ex?.label?.trim()?.toLowerCase() === candLabel;
        if (labelMatch) {
          return idx;
        }
      }
    }
    for (const idx of availableIndices) {
      const ex = existing[idx];
      if (ex?.type?.trim()?.toLowerCase() === candidate.type?.trim()?.toLowerCase()) {
        return idx;
      }
    }
    return null;
  };

  const normalized: GardenZone[] = [];

  for (const candidate of parsed) {
    const matchIdx = pickMatchIndex(candidate);
    if (matchIdx != null) {
      const matched = existing[matchIdx];
      const id = ensureUniqueId(
        matched?.id ?? normalizeZoneId(matched?.label ?? ''),
        usedIds,
        `${idPrefix}_zone_${matchIdx}`,
      );
      normalized.push({ ...candidate, id });
      availableIndices.delete(matchIdx);
      continue;
    }

    if (!hasAddIntent) {
      if (availableIndices.size > 0) {
        const idx = [...availableIndices][0];
        const matched = existing[idx];
        const id = ensureUniqueId(
          matched?.id ?? normalizeZoneId(matched?.label ?? ''),
          usedIds,
          `${idPrefix}_zone_${idx}`,
        );
        normalized.push({ ...candidate, id });
        availableIndices.delete(idx);
      }
      continue;
    }

    const fallbackId = `${idPrefix}_zone_${normalized.length}_${randomId()}`;
    const baseId = candidate.label ? normalizeZoneId(candidate.label) : fallbackId;
    const id = ensureUniqueId(baseId, usedIds, fallbackId);
    normalized.push({ ...candidate, id });
  }

  if (!hasRemoveIntent && availableIndices.size > 0) {
    for (const idx of availableIndices) {
      const z = existing[idx];
      if (!z) continue;
      const id = ensureUniqueId(z.id ?? normalizeZoneId(z.label ?? ''), usedIds, `${idPrefix}_zone_${idx}`);
      normalized.push({
        id,
        type: z.type?.trim() || 'unknown',
        label: z.label?.trim(),
        confidence: z.confidence,
        points: z.points ?? [],
      });
    }
  }

  return normalized;
}

function normalizeZoneId(label: string) {
  const normalized = normalizeId(label);
  return normalized.startsWith('zone-') ? normalized : `zone-${normalized}`;
}

function buildEdgeMetadata(points: GardenLayoutSummary['points'], closed = true): EdgeMetadata[] {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }
  const edges: EdgeMetadata[] = [];
  const lastIdx = points.length - 1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    edges.push({
      index: i,
      from,
      to,
      bearing_deg: computeBearing(from, to),
      length: Math.hypot(to.x - from.x, to.y - from.y),
    });
  }
  // If closed, add closing edge
  if (closed && points[0] && points[lastIdx]) {
    edges.push({
      index: edges.length,
      from: points[lastIdx],
      to: points[0],
      bearing_deg: computeBearing(points[lastIdx], points[0]),
      length: Math.hypot(points[0].x - points[lastIdx].x, points[0].y - points[lastIdx].y),
    });
  }
  return edges;
}

function computeBearing(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angleRad = Math.atan2(dx, dy); // screen coords: y down, so swap
  let deg = (angleRad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Number(deg.toFixed(2));
}

function estimateNorthBearing(points: GardenLayoutSummary['points']): number | null {
  const edges = buildEdgeMetadata(points, true);
  if (!edges.length) return null;
  // Use the longest edge as a stable reference for orientation guess.
  let maxEdge = edges[0];
  for (const e of edges) {
    if (e.length > maxEdge.length) maxEdge = e;
  }
  return maxEdge.bearing_deg;
}

function buildSegmentEdgeHints(
  segments: TranscriptSegment[],
  headings: HeadingSample[],
  layout: GardenLayoutSummary | undefined,
): SegmentEdgeHint[] {
  const edges = buildEdgeMetadata(layout?.points ?? [], layout?.closed ?? true);
  if (!segments?.length || !edges.length) {
    return [];
  }
  const headingMap = new Map<number, number>();
  for (const sample of headings ?? []) {
    if (Number.isFinite(sample?.heading_deg)) {
      headingMap.set(sample.second, sample.heading_deg);
    }
  }

  const nearestHeading = (second: number): number | null => {
    if (headingMap.has(second)) return headingMap.get(second)!;
    let best: { second: number; value: number; dist: number } | null = null;
    for (const [sec, value] of headingMap.entries()) {
      const dist = Math.abs(sec - second);
      if (best == null || dist < best.dist) {
        best = { second: sec, value, dist };
      }
    }
    return best ? best.value : null;
  };

  const bearingDiff = (a: number, b: number) => {
    const diff = Math.abs(((a - b + 180 + 360) % 360) - 180);
    return diff;
  };

  return segments.map((segment, idx) => {
    const h = nearestHeading(Math.round(segment.start_s ?? 0));
    let candidateEdgeIndex: number | null = null;
    if (h != null && edges.length) {
      let bestDiff = Infinity;
      edges.forEach((edge) => {
        const diff = bearingDiff(h, edge.bearing_deg);
        if (diff < bestDiff) {
          bestDiff = diff;
          candidateEdgeIndex = edge.index;
        }
      });
    }
    return {
      segmentIndex: idx,
      start_s: segment.start_s ?? 0,
      heading_deg: h,
      candidateEdgeIndex,
    };
  });
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
