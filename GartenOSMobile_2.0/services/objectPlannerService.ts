import { TranscriptSegment } from './geminiService';

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
    'You are GartenOS, a meticulous landscape assistant. ' +
    'You receive a fixed garden polygon and a timestamped narration of a walkthrough. ' +
    'Your job is ONLY to suggest object placements (trees, shrubs, water, beds, etc.) as map coordinates. ' +
    'Never alter the polygon, scale, or existing annotations. Output must be JSON conforming to the provided schema.';

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
