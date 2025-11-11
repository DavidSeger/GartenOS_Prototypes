// scripts/runAiPlacement.ts
import fs from 'fs';
import path from 'path';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4o';
const OPENAI_API_URL =
  process.env.EXPO_PUBLIC_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions';

type TranscriptSegment = { start_s: number; end_s: number; text: string };
type HeadingSample = { second: number; heading_deg: number };
type GardenAnnotation = { id?: string; type: string; x: number; y: number; label?: string; confidence?: number };
type GardenLayoutSummary = { points: Array<{ x: number; y: number }>; closed: boolean; scale: number; extent?: Record<string, unknown> };

if (!OPENAI_API_KEY) {
  console.error('Please set EXPO_PUBLIC_OPENAI_API_KEY before running this script.');
  process.exit(1);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npx ts-node scripts/runAiPlacement.ts <path-to-export.json>');
    process.exit(1);
  }

  const filePath = path.resolve(inputPath);
  console.log(`[1/7] Loading ${filePath}`);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const layout: GardenLayoutSummary | undefined = raw.cornerDrawing;
  const corners = Array.isArray(raw.corners) ? raw.corners : [];
  const transcriptSegments: TranscriptSegment[] = Array.isArray(raw.transcriptSegments) ? raw.transcriptSegments : [];
  const headings: HeadingSample[] = Array.isArray(raw.headings) ? raw.headings : [];
  const existingAnnotations: GardenAnnotation[] = Array.isArray(raw.annotations) ? raw.annotations : [];

  if (!layout?.points?.length) {
    console.error('cornerDrawing.points missing; cannot build AI context.');
    process.exit(1);
  }

  console.log(`[2/7] Layout points: ${layout.points.length}`);
  console.log(`[3/7] Transcript segments: ${transcriptSegments.length}`);
  console.log(`[4/7] Heading samples: ${headings.length}`);
  console.log(`[5/7] Existing annotations: ${existingAnnotations.length}`);

  const systemPrompt =
    'You are GartenOS, a meticulous landscape assistant. You receive a fixed garden polygon and a narrated walkthrough. ' +
    'Your only job is to propose object placements (trees, shrubs, water, planters) as coordinates. Never alter the polygon or existing annotations. ' +
    'Respond strictly with JSON matching the provided schema.';

  const context = {
    layout,
    corners: corners.map((c: any) => ({ latitude: c.latitude, longitude: c.longitude })),
    transcriptSegments,
    headings,
    existingAnnotations,
  };

  console.log('[6/7] Calling OpenAI…');
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
                'Add objects described in the transcript. Use headings to infer direction. ' +
                'Return JSON with only the new objects; coordinates share the same space as layout.points.',
            },
            { type: 'text', text: JSON.stringify(context) },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI call failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.warn('OpenAI returned no content.');
    return;
  }

  const parsed = JSON.parse(content) as { objects?: GardenAnnotation[] };
  const objects = parsed.objects ?? [];
  console.log(`[7/7] AI returned ${objects.length} object(s):`);
  objects.forEach((obj, idx) => {
    console.log(`  [${idx}] type=${obj.type} x=${obj.x} y=${obj.y} label=${obj.label ?? ''} conf=${obj.confidence ?? ''}`);
  });
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
