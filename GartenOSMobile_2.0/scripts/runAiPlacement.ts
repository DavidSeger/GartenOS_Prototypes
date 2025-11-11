import fs from "fs";
import path from "path";

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? "gpt-4o";
const OPENAI_API_URL =
  process.env.EXPO_PUBLIC_OPENAI_API_URL ?? "https://api.openai.com/v1/chat/completions";

if (!OPENAI_API_KEY) {
  console.error("EXPO_PUBLIC_OPENAI_API_KEY is not set. Aborting.");
  process.exit(1);
}

if (process.argv.length < 3) {
  console.error("Usage: npx ts-node scripts/runAiPlacement.ts <path-to-json>");
  process.exit(1);
}

const inputPath = path.resolve(process.argv[2]);
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

console.log(`[1/6] Loading ${inputPath}`);
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const layout = raw.cornerDrawing;
const corners = Array.isArray(raw.corners) ? raw.corners : [];
const transcriptSegments = Array.isArray(raw.transcriptSegments) ? raw.transcriptSegments : [];
const headings = Array.isArray(raw.headings) ? raw.headings : [];
const existingAnnotations = Array.isArray(raw.annotations) ? raw.annotations : [];

if (!layout?.points?.length) {
  console.error("cornerDrawing.points missing; cannot call AI.");
  process.exit(1);
}

console.log(`[2/6] Layout points: ${layout.points.length}`);
console.log(`[3/6] Transcript segments: ${transcriptSegments.length}`);
console.log(`[4/6] Heading samples: ${headings.length}`);
console.log(`[5/6] Existing annotations: ${existingAnnotations.length}`);

const systemPrompt =
  "You are GartenOS, a meticulous landscape assistant. Given a fixed polygon and narrated walkthrough, " +
  "suggest object placements (trees, shrubs, water features) as coordinates. Never alter the polygon.";

const contextPayload = {
  layout,
  corners: corners.map((c: any) => ({ latitude: c.latitude, longitude: c.longitude })),
  transcriptSegments,
  headings,
  existingAnnotations,
};

async function run() {
  console.log("[6/6] Calling OpenAI...");
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "garden_annotations",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["objects"],
            properties: {
              objects: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "x", "y"],
                  properties: {
                    type: { type: "string" },
                    label: { type: "string" },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    x: { type: "number" },
                    y: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Add objects mentioned in the transcript. Use headings to infer direction. Return JSON only.",
            },
            { type: "text", text: JSON.stringify(contextPayload) },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`OpenAI call failed (${response.status}): ${err}`);
    process.exit(1);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    console.warn("OpenAI returned empty content.");
    return;
  }

  const parsed = JSON.parse(content) as { objects?: Array<{ type: string; x: number; y: number; label?: string }> };
  const objects = parsed.objects ?? [];
  console.log(`OpenAI suggested ${objects.length} object(s):`);
  objects.forEach((obj, idx) => {
    console.log(`  [${idx}] type=${obj.type} x=${obj.x} y=${obj.y} label=${obj.label ?? ""}`);
  });
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
