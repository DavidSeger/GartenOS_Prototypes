import { TranscriptSegment } from './geminiService.ts';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_API_URL =
  process.env.EXPO_PUBLIC_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o-mini';

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

export type ObjectPlannerContext = {
  layout: GardenLayoutSummary;
  corners: Array<{ latitude: number; longitude: number }>;
  transcriptSegments: TranscriptSegment[];
  headings: HeadingSample[];
  existingAnnotations?: GardenAnnotation[];
};

type PlannerResponse = {
  objects: Array<{
    type: string;
    x: number;
    y: number;
    label?: string;
    confidence?: number;
  }>;
};

export async function suggestAnnotationsWithChatGPT(
  context: ObjectPlannerContext,
): Promise<GardenAnnotation[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('EXPO_PUBLIC_OPENAI_API_KEY is not configured.');
  }

  if (!context.layout?.points?.length) {
    return [];
  }

  const systemPrompt =
      'You are GartenOS, a meticulous landscape assistant for a garden biodiversity app. ' +
      'You receive a FIXED garden JSON map (polygon, scale, extent, existing annotations/zones),' +
      ' a timestamped walkthrough transcript, and possibly timestamped heading/orientation and GPS data. ' +
      '' +
      'Your ONLY job is to suggest NEW object placements (trees, shrubs, water, beds, structures) as map coordinates' +
      ' and append them to the existing annotations according to the provided schema. ' +
      '' +
      'Non-negotiable restraints: ' +
      '• Never alter the garden polygon or its points. ' +
      '• Never alter scale, extent, unit, or calibratedEdgeIndex. ' +
      '• Never delete, rename, or rewrite existing annotations or zones. ' +
      '• Never normalize or reorder unrelated parts of the JSON. ' +
      '• Output must be valid JSON conforming exactly to the provided schema. ' +
      '' +
      'Placement logic (very important): ' +
      '1) Treat the transcript as a sequence of segments tied to time. Whenever the narrator says things like "now we are at this edge", "now I am here", or when heading changes strongly, start a NEW edge segment. ' +
      '2) For each segment where trees/objects are mentioned "along the edge" or "to the left/right while walking", you MUST first decide which polygon edge the user is likely walking along. ' +
      '3) To decide the edge, compare the current heading/orientation to the bearing of each polygon edge (edge = line between two consecutive polygon/cornerDrawing points) and pick the edge whose direction is closest to the heading at that timestamp. ' +
      '4) Once an edge is selected, place the mentioned objects ON THAT EDGE by interpolating positions between the two edge endpoints. Do NOT place them on an arbitrary horizontal or vertical line. Do NOT place them outside the polygon. ' +
      '5) If the transcript says "three trees in equal distance", distribute exactly three points evenly along the chosen edge segment. ' +
      '6) If the transcript later says "on the longer edge four trees", treat that as a NEW edge with its own distribution — do NOT continue the previous line. ' +
      '7) If you cannot unambiguously map a transcript segment to a polygon edge, set the annotation with an "uncertain": true (if schema allows) and do NOT fall back to a made-up straight line. ' +
      '' +
      'Directional inference: ' +
      '• Phrases like "to the left of me" / "to the right of me" must be resolved relative' +
      ' to the heading at that second. ' +
      '• If the user is walking along an edge, "to the left" usually means inside or on the boundary of the polygon;' +
      ' prefer coordinates just inside or on the edge. ' +
      '• If heading data is sparse, interpolate from the nearest timestamps. ' +
      '' +
      'Handling summary statements: ' +
      '• If the transcript later summarizes ("we have 12 trees on three edges"), do NOT re-create or move previously' +
      ' placed trees. Treat summaries as validation, not as new placement instructions. ' +
      '• Never place more objects on one edge than the transcript indicates for that edge. ' +
      '' +
      'GPS / extra data: ' +
      '• If GPS points or cornerDrawing are present, treat them as higher-authority geometry than the natural-language description. ' +
      '• When GPS timestamps overlap transcript timestamps, align them by time and use the nearest GPS point to locate the user along the polygon at that moment. ' +
      '• Snap to polygon edges derived from cornerDrawing.points whenever possible. ' +
      '' +
      'After producing the JSON, you MAY (if the caller accepts extra fields) add a small "meta" or ' +
      '"accuracy_suggestions" field describing what extra data (denser headings, spoken distances, ' +
      'photos at key timestamps) would reduce ambiguity. ' +
      'If the schema does NOT allow extra fields, only return the updated JSON without suggestions. ' +
      '' +
      'Output discipline: ' +
      '• Primary output is the updated JSON map with newly appended annotations. ' +
      '• Preserve all existing fields and values exactly. ' +
      '• Do NOT explain before the JSON. ';


  const instructions = {
    layout: context.layout,
    corners: context.corners?.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    existingAnnotations: context.existingAnnotations ?? [],
    transcriptSegments: context.transcriptSegments,
    headings: context.headings,
  };

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
            required: ['objects'],
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
            },
          },
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Add trees/shrubs/water features described in the transcript. ' +
                'Use headings to infer relative direction. ' +
                'Return JSON with only the new objects. Coordinates use the same space as layout.points.',
            },
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
    return [];
  }

  let parsed: PlannerResponse;
  try {
    parsed = JSON.parse(content) as PlannerResponse;
  } catch (error) {
    throw new Error(`Unable to parse ChatGPT response: ${(error as Error).message}`);
  }

  return (parsed.objects ?? []).map((obj, index) => ({
    id: obj?.label ? normalizeId(obj.label) : `ai_${index}_${randomId()}`,
    type: obj.type?.trim() || 'unknown',
    x: obj.x,
    y: obj.y,
    label: obj.label?.trim(),
    confidence: obj.confidence,
  }));
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
