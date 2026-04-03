import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  buildWebContext,
  searchWeb,
  type SearchResult,
} from "../lib/web-search.js";
import {
  runGuardedProviderStream,
  toTerminalError,
  type GuardedProviderStreamResult,
} from "../lib/provider-stream-guard.js";
import { createGeneratedImage } from "../lib/image-generation/create-generated-image.js";
import { routeImagePrompt } from "../lib/image-generation/route-image-prompt.js";
import { getOrCreateAnonymousOwnerId } from "../lib/anonymous-owner.js";
import {
  resolveAnthropicUpstreamModel,
  resolveGeminiUpstreamModel,
  resolveOpenAiUpstreamModel,
} from "../lib/agentrouter-upstream-models.js";
import { createThinkingTagParser } from "../lib/thinking-tag-parser.js";
import { z } from "zod";

const router = Router();

const MODELS = {
  "gpt-5.2": "GPT 5.4 High",
  "claude-opus-4-6": "Claude Opus 4.6",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
} as const;

type ModelId = keyof typeof MODELS;
type ResponseCandidate = { model: ModelId; label: string; response: string };
type ModeratorReview = {
  rawOutput: string;
  choice?: ModelId;
  note?: string;
};

type StreamRequestContext = {
  requestId?: string;
  logger: {
    info: (bindings: Record<string, unknown>, message?: string) => void;
    warn: (bindings: Record<string, unknown>, message?: string) => void;
    error: (bindings: Record<string, unknown>, message?: string) => void;
  };
  signal: AbortSignal;
};

const PROVIDER_OVERALL_TIMEOUT_MS = 120_000;
const PROVIDER_FIRST_CHUNK_TIMEOUT_MS = 45_000;
const PROVIDER_HARD_TIMEOUT_MS = PROVIDER_OVERALL_TIMEOUT_MS + 10_000;
const GEMINI_OVERALL_TIMEOUT_MS = 600_000;
const GEMINI_FIRST_CHUNK_TIMEOUT_MS = 180_000;
const GEMINI_HARD_TIMEOUT_MS = GEMINI_OVERALL_TIMEOUT_MS + 10_000;
const SUMMARIZER_FIRST_CHUNK_TIMEOUT_MS = PROVIDER_OVERALL_TIMEOUT_MS;

type ChatMessage = { role: "user" | "assistant"; content: string };

const MultiChatSchema = z.object({
  prompt: z.string().min(1),
  models: z
    .array(z.enum(["gpt-5.2", "claude-opus-4-6", "gemini-3.1-pro-preview"]))
    .min(2)
    .refine((models) => new Set(models).size === models.length, {
      message: "Models must be unique",
    }),
  webSearch: z.boolean().optional().default(false),
  mode: z.enum(["chat", "image"]).optional().default("chat"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional()
    .default([]),
});

async function callGPT(
  history: ChatMessage[],
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [];
  if (webContext) messages.push({ role: "system", content: webContext });
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: "user", content: prompt });

  return runGuardedProviderStream({
    provider: "openai:gpt-5.2",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = await openai.chat.completions.create(
        {
          model: resolveOpenAiUpstreamModel("gpt-5.2"),
          max_completion_tokens: 8192,
          messages,
          stream: true,
        },
        { signal },
      );
      return { stream };
    },
    getChunkText: (chunk) => chunk.choices[0]?.delta?.content,
    onChunk,
  });
}

async function callClaude(
  history: ChatMessage[],
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const claudeMessages = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: prompt },
  ];
  return runGuardedProviderStream({
    provider: "anthropic:claude-opus-4-6",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async () => {
      const stream = anthropic.messages.stream({
        model: resolveAnthropicUpstreamModel("claude-opus-4-6"),
        max_tokens: 8192,
        system: webContext ?? undefined,
        messages: claudeMessages,
      });
      return { stream, abort: () => stream.abort() };
    },
    getChunkText: (event) => {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        return event.delta.text;
      }
      return null;
    },
    onChunk,
  });
}

function getGeminiChunkText(chunk: unknown): string | null {
  const c = chunk as {
    text?: string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };

  if (typeof c.text === "string" && c.text.length > 0) {
    return c.text;
  }

  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return null;

  let out = "";
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === "string" && part.text.length > 0) {
      out += part.text;
    }
  }

  return out.length > 0 ? out : null;
}

async function callGemini(
  history: ChatMessage[],
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }
  if (webContext) {
    contents.push({ role: "user", parts: [{ text: webContext }] });
    contents.push({
      role: "model",
      parts: [
        { text: "Understood. I will use these results to inform my answer." },
      ],
    });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  return runGuardedProviderStream({
    provider: "gemini:gemini-3.1-pro-preview",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: GEMINI_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: GEMINI_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = (await ai.models.generateContentStream({
        model: resolveGeminiUpstreamModel("gemini-3.1-pro-preview"),
        contents,
        config: { maxOutputTokens: 8192, abortSignal: signal },
      })) as AsyncIterable<unknown>;
      return { stream };
    },
    getChunkText: (chunk) => getGeminiChunkText(chunk),
    onChunk,
  });
}

// Image mode: prompts for improving image generation prompts
const IMAGE_MODE_MODEL_SYSTEM_PROMPT = `You are an elite AI image prompt architect with deep expertise in Midjourney, DALL-E 3, Stable Diffusion, and other leading image generators. Your mission is to transform any user request into a production-grade prompt that will yield a stunning, professional-quality image.

## Your Core Task
Analyze the user's request, then craft a comprehensive prompt that leaves NO ambiguity about the desired output. Think like a professional art director briefing a team—every detail matters.

## COMPREHENSIVE PROMPT STRUCTURE

### 1. SUBJECT DEFINITION (Primary Focus)
The subject is the core of your prompt. Be EXHAUSTIVE:
- Exact species/breed/type (e.g., "Siberian husky" not just "dog")
- Physical details: age, gender, body type, fur/skin texture, distinctive markings
- Pose: standing, sitting, running, mid-air, interaction with objects
- Expression: specific emotion (not just "happy"), eye direction, facial muscle tension
- Clothing/accessories if applicable: style, material, fit, colors
- Count: "a group of 5 people", "three kittens", "a flock of birds"

### 2. COMPOSITION & FRAMING
- Camera POV: eye-level, high angle (bird's eye), low angle (worm's eye), dutch angle, over-the-shoulder
- Shot type: extreme close-up, close-up, medium close-up, medium shot, medium wide, wide shot, extreme wide
- Depth: foreground/midground/background clarity, shallow DOF (f/1.4), deep DOF (f/16), tilt-shift effect
- Rule of thirds, centered, diagonal, golden ratio composition
- Headroom/lead room considerations
- Negative space usage

### 3. LIGHTING (Critical for Quality)
Specify EVERY lighting element:
- Source type: golden hour sun, blue hour ambient, studio strobes, ring light, window light, neon signs, firelight, moonlight
- Direction: front-lit, side-lit (left/right), backlit, rim light, under-lighting
- Quality: hard light (sharp shadows), soft light (gentle shadows), diffused, bouncing
- Mood: dramatic shadows, high key (bright), low key (dark/moody), chiaroscuro
- Color temperature: warm (2700K), cool (6500K), mixed
- Atmospheric: lens flare, god rays, volumetric fog, dust motes, steam

### 4. ENVIRONMENT & BACKGROUND
- Location type: indoor/outdoor, specific setting (forest, studio, kitchen, cyberpunk street)
- Time of day: dawn, morning, noon, afternoon, golden hour, blue hour, night
- Weather: clear, overcast, rain, fog, snow, thunderstorm
- Background elements: cityscape, bokeh lights, blurred trees, gradient backdrop
- Depth and distance elements

### 5. COLOR & PALETTE
- Dominant colors: "dominant deep teal with coral accents"
- Color harmony: complementary, analogous, triadic, split-complementary
- Saturation: vibrant, muted, desaturated, high contrast
- Tonal range: bright/high-key, dark/low-key, full tonal range
- Color temperature: warm, cool, neutral

### 6. ART MEDIUM & STYLE
Choose ONE primary medium, then add style modifiers:
- Photography: portrait, landscape, street, fashion, documentary, cinematic, editorial
- Digital art: digital painting, concept art, matte painting, character design
- Traditional: oil painting, watercolor, charcoal sketch, pencil drawing
- Illustration: flat vector, isometric, children's book, manga, anime
- 3D: Blender render, Unreal Engine 5, octane render, toon shader
- Specific styles: cyberpunk, steampunk, solarpunk, noir, art deco, brutalist, minimalist

### 7. TEXT/TYPOGRAPHY (If Applicable)
- Font style: serif, sans-serif, display, handwritten, script
- Text content: exact words
- Placement: centered, bottom third, diagonal
- Effects: embossed, neon, metallic, painted

### 8. TECHNICAL QUALITY TAGS
Add these to ensure best results:
- Resolution: 8k, 4k, ultra high resolution
- Quality: masterpiece, best quality, ultra detailed, extremely detailed
- Rendering: ray tracing, octane render, cycles render, unreal engine 5
- Style modifiers: trending on artstation, concept art, detailed illustration
- Negative quality: low quality, worst quality, blurry, jpeg artifacts (to avoid)

### 9. ASPECT RATIO
- Portrait (9:16) - for social media, phone
- Landscape (16:9) - for cinematic
- Square (1:1) - for Instagram
- Ultra-wide (21:9) - panoramic
- Golden ratio (1.618:1)

### 10. FINISHING TOUCHES
- Post-processing: color grading, vignette, film grain, noise reduction
- Effects: bokeh, motion blur, freeze frame, tilt-shift
- Camera details: lens type (85mm portrait, 24mm wide), aperture, ISO

## EXAMPLES OF TRANSFORMATION

Example 1:
User: "A sunset"
Output: "Panoramic landscape of golden hour sunset over ocean, waves crashing on rocky coastline, warm amber and coral sky with wispy cirrus clouds catching last light, silhouette of seagulls in flight, long exposure silky water, dramatic rim lighting on cliff edges, rich earth tones in foreground rocks, cinematic 16:9 aspect ratio, film grain, color graded orange-teal, masterpiece, best quality, 8k, unreal engine 5 render"

Example 2:
User: "A person working"
Output: "Medium shot of diverse young woman in her late 20s working at standing desk in modern minimalist home office, warm natural window light from left, wearing fitted navy blue sweater and gold hoop earrings, focused expression looking at monitor, motion blur on hands typing, shallow depth of field with blurred ergonomic keyboard and plant in background, clean white walls with abstract art, morning light atmosphere, soft cinematic color grading, Canon 85mm f/1.4, professional photography, detailed, 4k, masterpiece"

Example 3:
User: "A robot"
Output: "Full-body humanoid robot companion, sleek matte white titanium alloy chassis with teal accent lighting along joints, warm amber LED eyes expressing curiosity, retro-futuristic design inspired by 1950s sci-fi, standing in abandoned warehouse with dusty golden light beams through broken skylights, rust and wear on exposed joints, industrial environment with overgrown vines, cinematic low-angle shot, dramatic chiaroscuro lighting, film grain, color graded desaturated with teal shadows, Blender 3D render, octane, concept art, trending on artstation, 8k, ultra detailed"

## STRICT OUTPUT RULES
- Write ONLY the improved prompt - no explanations, no markdown, no quotes, no commentary
- Use COMMAS to separate concepts, not periods
- Write in clear, descriptive English
- 100-400 words of substance (not counting quality tags)
- The prompt must work WITHOUT the original request
- NEVER use vague words: "beautiful", "nice", "pretty", "cool", "good", "cute"
- Instead of "beautiful" say: "ethereal", "stunning", "striking", "elegant"
- Instead of "cute" say: "playful", "charming", "endearing", "whimsical"

Now transform the user's request into a professional-grade image prompt.`;

const IMAGE_MODE_MODERATOR_SYSTEM_PROMPT = `You are an elite image prompt curator with deep expertise in AI image generation across Midjourney, DALL-E 3, Stable Diffusion, and similar systems. You have a proven eye for what separates good prompts from exceptional ones that produce stunning, professional-quality images.

## Your Critical Task
You will receive 3 improved prompts from different AI models. Your job is to evaluate each rigorously and select the ONE that will most likely produce a high-quality, coherent, visually striking image.

## EVALUATION FRAMEWORK (Score each prompt 1-10)

### A. SUBJECT CLARITY (20 points)
- Is the subject defined with SPECIFIC, unambiguous details?
- Are physical characteristics precise? (breed, color, age, material, texture)
- Is the count/quantity clear? (one vs multiple vs group)
- Could a stranger generate this exact subject based on the prompt?

### B. COMPOSITION & FRAMING (15 points)
- Does it specify camera angle and perspective?
- Is shot type defined (close-up, wide, etc.)?
- Is depth of field mentioned?
- Is the visual hierarchy clear?

### C. LIGHTING EXPLICITNESS (20 points)
- Is light source explicitly stated?
- Are direction and quality of light defined?
- Are atmospheric effects specified?
- Does lighting support the mood/intent?

### D. STYLE COHERNECE (15 points)
- Is art medium clearly defined?
- Are style modifiers consistent and appropriate?
- Does the prompt have a unified visual vision?

### E. TECHNICAL COMPLETENESS (15 points)
- Are quality tags present and appropriate?
- Is aspect ratio specified if important?
- Are render/execution details included?

### F. PRODUCTION READINESS (15 points)
- Would this prompt work standalone without the original request?
- Are there vague/adjective-heavy sections that could confuse the generator?
- Is the prompt 100-300 words of meaningful substance?

## YOUR PROCESS
1. Read through all 3 prompts carefully
2. Score each against the framework above
3. Identify the winner (there MUST be a clear winner)
4. Note the specific reasons why the winner excels

## OUTPUT FORMAT (STRICT)
Your entire response must be exactly:
"Response X is the best. Side note: [1-2 sentences on what makes this prompt superior—specific details, not generic praise]"

Where X is 1, 2, or 3.

Example: "Response 2 is the best. Side note: It uniquely specifies golden hour warm backlighting and includes realistic fabric texture details that the other prompts omit."

If prompts are truly equal (extremely rare), pick one anyway—decisiveness is required.`;

const IMAGE_MODE_SUMMARIZER_SYSTEM_PROMPT = `You are a master image prompt architect with 10+ years of experience in visual design, AI art generation, and prompt engineering. You've seen thousands of prompts and know exactly what makes one succeed or fail.

## Your Mission
Take 3 different AI-improved prompts and synthesize them into ONE perfect, production-ready prompt that is GREATER than the sum of its parts. The final prompt should be so good that you'd bet on it producing a stunning image.

## SYNTHESIS METHODOLOGY

### Phase 1: Deep Analysis (in your <thinking>)
Read each prompt multiple times. For each, identify:
- **Unique wins**: Details ONLY this prompt has that are valuable
- **Missing elements**: What this prompt lacks that others have
- **Strongest sections**: The best-written parts
- **Weakest sections**: Vague areas, contradictions, or gaps

### Phase 2: Strategic Combination
Pick and choose the BEST elements from EACH prompt:
- From Prompt 1: Subject definition + specific physical details
- From Prompt 2: Lighting description + atmospheric quality
- From Prompt 3: Style execution + technical specifications

Merge them into a COHERENT vision—not a Frankenstein mess.

### Phase 3: Hardening (Critical)
Review your combined draft:
- Fill gaps: If no prompt specified camera angle, add one
- Strengthen lighting: Make it more specific and intentional
- Clarify subject: Ensure no ambiguity remains
- Polish flow: Use commas to connect ideas naturally
- Add missing basics: Aspect ratio, quality tags if absent

### Phase 4: Quality Verification
Before outputting, check:
- [ ] Subject is specific and unambiguous
- [ ] Lighting is fully specified (source, direction, mood)
- [ ] Composition/framing is clear
- [ ] Art medium and style are defined
- [ ] Technical quality tags are present
- [ ] Prompt works standalone (no "as shown" references)
- [ ] No vague words remain
- [ ] Length is 150-350 words of substance

## YOUR THINKING PROCESS
Inside <thinking> tags, show your work:
1. What did you take from each prompt and why?
2. What did you add or improve?
3. How does this final version exceed any individual prompt?

## FINAL OUTPUT
After your thinking, output ONLY the polished prompt:
- No markdown formatting
- No quotes around the prompt
- Just pure, production-ready prompt text
- 150-350 words of meaningful substance
- Quality tags included at the end

Format:
<thinking>
Your detailed synthesis reasoning here—be thorough, show your expertise
</thinking>
Your final polished prompt here, ready for image generation`;

async function callClaudeTask(
  provider: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
  firstChunkTimeoutMs = PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
): Promise<GuardedProviderStreamResult> {
  return runGuardedProviderStream({
    provider,
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs,
    externalAbortSignal: context.signal,
    startStream: async () => {
      const stream = anthropic.messages.stream({
        model: resolveAnthropicUpstreamModel("claude-opus-4-6"),
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      return { stream, abort: () => stream.abort() };
    },
    getChunkText: (event) => {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        return event.delta.text;
      }
      return null;
    },
    onChunk,
  });
}

async function callModerator(
  history: ChatMessage[],
  prompt: string,
  responses: ResponseCandidate[],
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult & ModeratorReview> {
  const responseBlock = responses
    .map((r, index) => `Response ${index + 1} (${r.label}):\n${r.response}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are a moderator. Your task is to review the responses and select the best one, providing a brief side note about your choice.

You will be given a user's question and several responses to it.

Review each response considering:
- Directness: Does the response directly answer the user's question without unnecessary preamble or tangents?
- Accuracy and correctness
- Completeness
- Clarity and helpfulness
- Any unique insights or value

Prioritize the response that most directly and concisely answers what the user actually asked.

After your review, output ONLY in this exact format:
"Response X is the best. Side note: [Your brief note about why you chose this response]"

Where X is the response number (1, 2, 3, etc.). Be concise but specific in your side note - explain the key reason for your choice in 1-2 sentences.`;

  const historyBlock =
    history.length > 0
      ? `Conversation so far:\n${history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n\n`
      : "";
  const userMessage = `${historyBlock}User's question:\n"${prompt}"\n\nResponses:\n\n${responseBlock}\n\nSelect the best response and provide your note.`;

  let bufferedOutput = "";

  const processChunk = (text: string) => {
    bufferedOutput += text;
    onChunk(text);
  };

  const result = await callClaudeTask(
    "anthropic:claude-opus-4-6-moderator",
    systemPrompt,
    userMessage,
    1024,
    processChunk,
    context,
  );

  const output = bufferedOutput.trim();
  const choiceMatch = output.match(/^Response (\d+) is the best\./i);
  const sideNoteMatch = output.match(/Side note:\s*([\s\S]*)$/i);

  const choice = choiceMatch
    ? responses[parseInt(choiceMatch[1]) - 1]?.model
    : undefined;
  const note = sideNoteMatch?.[1]?.trim();

  return { ...result, rawOutput: output, choice, note };
}

async function callSummarizer(
  history: ChatMessage[],
  prompt: string,
  responses: ResponseCandidate[],
  moderatorReview: ModeratorReview | null,
  onChunk: (text: string) => void,
  onThinkingChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const responseBlock = responses
    .map((r) => `### ${r.label}\n${r.response}`)
    .join("\n\n");
  const moderatorBlock = moderatorReview
    ? `Moderator review:\n${moderatorReview.rawOutput || "No moderator output."}\n\nParsed choice: ${moderatorReview.choice ? MODELS[moderatorReview.choice] : "Unavailable"}\nParsed note: ${moderatorReview.note ?? "Unavailable"}`
    : "Moderator review:\nUnavailable.";

  const systemPrompt = `You are a summariser. You will be given a user's question and several responses to it.

Before writing your answer, reason through the responses inside <thinking>...</thinking> tags. In your thinking, consider:
- What the user is actually asking for
- What unique insights each response offers
- Where the responses agree and disagree
- Which points are most accurate and helpful
- How to directly answer the user's question using the best information

Use the moderator's review as a strong signal, but not as ground truth. Verify it against the responses yourself and keep the best accurate details even if they came from a response the moderator did not pick.

After closing the </thinking> tag, write a direct answer to the user's question. Lead with the answer itself — do not start with background context, disclaimers, or meta-commentary about the responses. Combine the best insights from all responses into a single, clear, and helpful reply. Do not mention any AI models, agents, or sources — just answer as if you are responding to the user yourself.`;
  const historyBlock =
    history.length > 0
      ? `Conversation so far:\n${history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n\n`
      : "";
  const userMessage = `${historyBlock}User's question:\n"${prompt}"\n\nResponses:\n\n${responseBlock}\n\n${moderatorBlock}\n\nReason through the responses in <thinking> tags, then summarise.`;

  const thinkingParser = createThinkingTagParser(onChunk, onThinkingChunk);

  const result = await callClaudeTask(
    "anthropic:claude-opus-4-6-summary",
    systemPrompt,
    userMessage,
    16384,
    thinkingParser.processText,
    context,
    SUMMARIZER_FIRST_CHUNK_TIMEOUT_MS,
  );

  thinkingParser.flush();
  return result;
}

// Image mode: call models with image prompt improvement system prompt
async function callImageModeModel(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const userMessage = `User's image request: "${prompt}"${webContext ? `\n\nWeb context: ${webContext}` : ""}\n\nOutput ONLY your improved prompt - no explanations, no quotes, just the prompt text that will produce an excellent image.`;

  return runGuardedProviderStream({
    provider: "openai:gpt-5.2-image-mode",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = await openai.chat.completions.create(
        {
          model: resolveOpenAiUpstreamModel("gpt-5.2"),
          max_completion_tokens: 2048,
          messages: [
            { role: "system", content: IMAGE_MODE_MODEL_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          stream: true,
        },
        { signal },
      );
      return { stream };
    },
    getChunkText: (chunk) => chunk.choices[0]?.delta?.content,
    onChunk,
  });
}

async function callImageModeClaude(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const userMessage = `User's image request: "${prompt}"${webContext ? `\n\nWeb context: ${webContext}` : ""}\n\nOutput ONLY your improved prompt - no explanations, no quotes, just the prompt text that will produce an excellent image.`;

  return runGuardedProviderStream({
    provider: "anthropic:claude-opus-4-6-image-mode",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: PROVIDER_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: PROVIDER_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async () => {
      const stream = anthropic.messages.stream({
        model: resolveAnthropicUpstreamModel("claude-opus-4-6"),
        max_tokens: 2048,
        system: IMAGE_MODE_MODEL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      return { stream, abort: () => stream.abort() };
    },
    getChunkText: (event) => {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        return event.delta.text;
      }
      return null;
    },
    onChunk,
  });
}

async function callImageModeGemini(
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [
    {
      role: "user",
      parts: [{ text: IMAGE_MODE_MODEL_SYSTEM_PROMPT }],
    },
    {
      role: "model",
      parts: [
        {
          text: "I understand. I'll improve the user's image prompt with detailed, specific instructions for lighting, composition, style, and subject clarity.",
        },
      ],
    },
    {
      role: "user",
      parts: [
        {
          text: `User's image request: "${prompt}"${webContext ? `\n\nWeb context: ${webContext}` : ""}`,
        },
      ],
    },
  ];

  return runGuardedProviderStream({
    provider: "gemini:gemini-3.1-pro-preview-image-mode",
    requestId: context.requestId,
    logger: context.logger,
    overallTimeoutMs: GEMINI_OVERALL_TIMEOUT_MS,
    firstChunkTimeoutMs: GEMINI_FIRST_CHUNK_TIMEOUT_MS,
    externalAbortSignal: context.signal,
    startStream: async ({ signal }) => {
      const stream = (await ai.models.generateContentStream({
        model: resolveGeminiUpstreamModel("gemini-3.1-pro-preview"),
        contents,
        config: { maxOutputTokens: 2048, abortSignal: signal },
      })) as AsyncIterable<unknown>;
      return { stream };
    },
    getChunkText: (chunk) => getGeminiChunkText(chunk),
    onChunk,
  });
}

// Image mode moderator - selects best prompt
async function callImageModeModerator(
  prompt: string,
  responses: ResponseCandidate[],
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult & ModeratorReview> {
  const responseBlock = responses
    .map((r, index) => `Prompt ${index + 1} (${r.label}):\n${r.response}`)
    .join("\n\n---\n\n");

  const userMessage = `User's original request: "${prompt}"\n\nImproved prompts:\n\n${responseBlock}\n\nSelect the best prompt and provide your note.`;

  let bufferedOutput = "";

  const processChunk = (text: string) => {
    bufferedOutput += text;
    onChunk(text);
  };

  const result = await callClaudeTask(
    "anthropic:claude-opus-4-6-image-moderator",
    IMAGE_MODE_MODERATOR_SYSTEM_PROMPT,
    userMessage,
    1024,
    processChunk,
    context,
  );

  const output = bufferedOutput.trim();
  const choiceMatch = output.match(/^Response (\d+) is the best\./i);
  const sideNoteMatch = output.match(/Side note:\s*([\s\S]*)$/i);

  const choice = choiceMatch
    ? responses[parseInt(choiceMatch[1]) - 1]?.model
    : undefined;
  const note = sideNoteMatch?.[1]?.trim();

  return { ...result, rawOutput: output, choice, note };
}

// Image mode summarizer - polishes the final prompt
async function callImageModeSummarizer(
  prompt: string,
  responses: ResponseCandidate[],
  moderatorReview: ModeratorReview | null,
  onChunk: (text: string) => void,
  onThinkingChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult> {
  const responseBlock = responses
    .map((r) => `### ${r.label}\n${r.response}`)
    .join("\n\n");
  const moderatorBlock = moderatorReview
    ? `Moderator review:\n${moderatorReview.rawOutput || "No moderator output."}\n\nParsed choice: ${moderatorReview.choice ? MODELS[moderatorReview.choice] : "Unavailable"}\nParsed note: ${moderatorReview.note ?? "Unavailable"}`
    : "Moderator review:\nUnavailable.";

  const userMessage = `User's original request: "${prompt}"\n\nImproved prompts:\n\n${responseBlock}\n\n${moderatorBlock}\n\nPolish the best prompt into the final image generation prompt.`;

  const thinkingParser = createThinkingTagParser(onChunk, onThinkingChunk);

  const result = await callClaudeTask(
    "anthropic:claude-opus-4-6-image-summarizer",
    IMAGE_MODE_SUMMARIZER_SYSTEM_PROMPT,
    userMessage,
    2048,
    thinkingParser.processText,
    context,
    SUMMARIZER_FIRST_CHUNK_TIMEOUT_MS,
  );

  thinkingParser.flush();
  return result;
}

type ModelOutcome =
  | { success: true; model: ModelId; label: string; response: string }
  | { success: false; model: ModelId };

const RETRIABLE_PROVIDER_ERROR_PATTERNS: RegExp[] = [
  /incomplete json segment/i,
  /unexpected end of json/i,
  /unexpected end/i,
  /invalid json/i,
  /connection error/i,
  /connection reset/i,
  /connection closed/i,
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /eai_again/i,
  /und_err_/i,
  /network error/i,
  /fetch failed/i,
  /rate limit/i,
  /\b429\b/i,
  /\b503\b/i,
  /service unavailable/i,
  /overloaded/i,
  /try again/i,
  /upstream prematurely closed connection/i,
  /stream ended unexpectedly/i,
];

function collectRetriableErrorText(error: Error | undefined): string {
  if (!error) {
    return "";
  }

  const parts: string[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);

    if (next instanceof Error) {
      parts.push(next.message);

      const withCause = next as Error & { cause?: unknown };
      if (withCause.cause) {
        queue.push(withCause.cause);
      }

      if (
        typeof AggregateError !== "undefined" &&
        next instanceof AggregateError &&
        Array.isArray(next.errors)
      ) {
        for (const nested of next.errors) {
          queue.push(nested);
        }
      }
      continue;
    }

    if (typeof next === "string") {
      parts.push(next);
    }
  }

  return parts.join(" | ");
}

function isRetriableProviderFailure(
  result: GuardedProviderStreamResult,
  streamAborted: boolean,
): boolean {
  if (streamAborted) {
    return false;
  }

  if (result.status === "timed_out") {
    return true;
  }

  if (result.status === "aborted") {
    return true;
  }

  if (result.status === "empty") {
    return true;
  }

  if (result.status !== "errored") {
    return false;
  }

  const message = collectRetriableErrorText(result.error);
  return RETRIABLE_PROVIDER_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

function dispatchModelCall(
  mode: "chat" | "image",
  modelId: ModelId,
  history: ChatMessage[],
  prompt: string,
  webContext: string | null,
  onChunk: (text: string) => void,
  context: StreamRequestContext,
): Promise<GuardedProviderStreamResult | null> {
  if (mode === "image") {
    if (modelId === "gpt-5.2")
      return callImageModeModel(prompt, webContext, onChunk, context);
    if (modelId === "claude-opus-4-6")
      return callImageModeClaude(prompt, webContext, onChunk, context);
    if (modelId === "gemini-3.1-pro-preview")
      return callImageModeGemini(prompt, webContext, onChunk, context);
    return Promise.resolve(null);
  }
  if (modelId === "gpt-5.2")
    return callGPT(history, prompt, webContext, onChunk, context);
  if (modelId === "claude-opus-4-6")
    return callClaude(history, prompt, webContext, onChunk, context);
  if (modelId === "gemini-3.1-pro-preview")
    return callGemini(history, prompt, webContext, onChunk, context);
  return Promise.resolve(null);
}

async function invokeModelWithGuard(
  modelId: ModelId,
  callProvider: (
    onChunk: (text: string) => void,
    context: StreamRequestContext,
  ) => Promise<GuardedProviderStreamResult | null>,
  send: (data: object) => boolean,
  streamContext: StreamRequestContext,
): Promise<ModelOutcome> {
  let terminalEmitted = false;
  let modelFinalized = false;
  const modelAbortController = new AbortController();
  const maxAttempts = 3;
  const retryDelayMs = 350;

  const emitModelDone = () => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    send({ type: "model_done", model: modelId });
  };

  const emitModelError = (error: string) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    send({ type: "model_error", model: modelId, error });
  };

  const modelSignal = AbortSignal.any([
    streamContext.signal,
    modelAbortController.signal,
  ]);
  const modelContext: StreamRequestContext = {
    requestId: streamContext.requestId,
    logger: streamContext.logger,
    signal: modelSignal,
  };

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      send({
        type: "model_start",
        model: modelId,
        label: MODELS[modelId],
        attempt,
      });

      const modelCallPromise = callProvider((text) => {
        if (!modelFinalized) {
          send({ type: "model_chunk", model: modelId, content: text });
        }
      }, modelContext);

      let hardTimeoutHandle: NodeJS.Timeout | null = null;
      const modelHardTimeoutMs =
        modelId === "gemini-3.1-pro-preview"
          ? GEMINI_HARD_TIMEOUT_MS
          : PROVIDER_HARD_TIMEOUT_MS;

      const raceResult = await Promise.race<
        GuardedProviderStreamResult | null | "hard_timeout"
      >([
        modelCallPromise,
        new Promise<"hard_timeout">((resolve) => {
          hardTimeoutHandle = setTimeout(
            () => resolve("hard_timeout"),
            modelHardTimeoutMs,
          );
        }),
      ]);

      if (hardTimeoutHandle) clearTimeout(hardTimeoutHandle);

      if (raceResult === "hard_timeout") {
        modelFinalized = true;
        if (!modelAbortController.signal.aborted) {
          modelAbortController.abort("model_hard_timeout");
        }
        emitModelError("Provider call timed out");
        void modelCallPromise.catch((err: unknown) => {
          if (!(err instanceof Error) || err.name !== "AbortError") {
            streamContext.logger.warn(
              { err, model: modelId },
              "Unexpected error after hard timeout",
            );
          }
        });
        return { success: false, model: modelId };
      }

      modelFinalized = true;

      if (!raceResult) {
        emitModelError("Unknown model");
        return { success: false, model: modelId };
      }

      const terminalError = toTerminalError(raceResult);
      const canRetry =
        attempt < maxAttempts &&
        isRetriableProviderFailure(raceResult, streamContext.signal.aborted);
      if (terminalError) {
        if (canRetry) {
          streamContext.logger.warn(
            {
              requestId: streamContext.requestId,
              model: modelId,
              attempt,
              terminalError,
            },
            "multi_chat_model_retrying_after_transient_failure",
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          if (streamContext.signal.aborted) {
            emitModelError("Provider stream aborted");
            return { success: false, model: modelId };
          }
          modelFinalized = false;
          continue;
        }

        emitModelError(terminalError);
        return { success: false, model: modelId };
      }

      emitModelDone();
      return {
        success: true,
        model: modelId,
        label: MODELS[modelId],
        response: raceResult.output,
      };
    }

    emitModelError("Provider stream failed");
    return { success: false, model: modelId };
  } catch (err) {
    modelFinalized = true;
    const message = err instanceof Error ? err.message : "Unknown error";
    emitModelError(message);
    return { success: false, model: modelId };
  }
}

router.post("/multi-chat", async (req, res) => {
  const parsed = MultiChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { prompt, models, webSearch, mode, history } = parsed.data;
  const requestWithLog = req as typeof req & {
    id?: string;
    log: StreamRequestContext["logger"];
  };

  // For image mode, get/create owner ID early for image generation later
  let imageOwnerId: string | undefined;
  if (mode === "image") {
    imageOwnerId = getOrCreateAnonymousOwnerId(req);
    // Set cookie for owner ID
    res.cookie("imagegen_owner_id", imageOwnerId, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      maxAge: 31536000 * 1000,
    });
  }

  const streamAbortController = new AbortController();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let connectionClosed = false;
  req.on("aborted", () => {
    connectionClosed = true;
    if (!streamAbortController.signal.aborted) {
      streamAbortController.abort("request_aborted");
    }
  });
  res.on("close", () => {
    connectionClosed = true;
    if (!streamAbortController.signal.aborted) {
      streamAbortController.abort("response_closed");
    }
  });

  const send = (data: object): boolean => {
    if (connectionClosed || res.writableEnded || res.destroyed) {
      return false;
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const flushableResponse = res as typeof res & { flush?: () => void };
    flushableResponse.flush?.();
    return true;
  };

  let webContext: string | null = null;
  let searchResults: SearchResult[] = [];

  try {
    if (webSearch) {
      send({ type: "search_start" });
      try {
        searchResults = await searchWeb(prompt);
        if (searchResults.length > 0) {
          webContext = buildWebContext(searchResults);
        }
        send({
          type: "search_done",
          results: searchResults.map((r) => ({ title: r.title, url: r.url })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Search failed";
        send({ type: "search_error", error: message });
      }
    }

    const streamContext: StreamRequestContext = {
      requestId: requestWithLog.id,
      logger: requestWithLog.log,
      signal: streamAbortController.signal,
    };

    const modelsToInvoke =
      mode === "image"
        ? ([
            "gpt-5.2",
            "claude-opus-4-6",
            "gemini-3.1-pro-preview",
          ] as ModelId[])
        : models;

    const modelOutcomes = await Promise.allSettled(
      modelsToInvoke.map((modelId) =>
        invokeModelWithGuard(
          modelId,
          (onChunk, ctx) =>
            dispatchModelCall(
              mode,
              modelId,
              history,
              prompt,
              webContext,
              onChunk,
              ctx,
            ),
          send,
          streamContext,
        ),
      ),
    );

    const successfulResponses = modelOutcomes.flatMap((outcome, index) => {
      if (outcome.status === "fulfilled" && outcome.value.success) {
        return [
          {
            model: outcome.value.model,
            label: outcome.value.label,
            response: outcome.value.response,
          },
        ];
      }

      if (outcome.status === "rejected") {
        requestWithLog.log.error(
          {
            requestId: requestWithLog.id,
            model: modelsToInvoke[index],
            err: outcome.reason,
          },
          "multi_chat_model_invoke_rejected",
        );
      }

      return [];
    });

    // Handle moderator and summarizer based on mode
    if (mode === "image") {
      // Image mode: use image-specific moderator and summarizer, then generate image
      let moderatorReview: ModeratorReview | null = null;

      if (successfulResponses.length >= 2) {
        send({ type: "moderator_start" });
        try {
          const moderatorResult = await callImageModeModerator(
            prompt,
            successfulResponses,
            (text) => send({ type: "moderator_chunk", content: text }),
            streamContext,
          );
          const terminalError = toTerminalError(moderatorResult);
          if (terminalError) {
            send({ type: "moderator_error", error: terminalError });
          } else {
            moderatorReview = {
              rawOutput: moderatorResult.rawOutput,
              choice: moderatorResult.choice,
              note: moderatorResult.note,
            };
            send({
              type: "moderator_done",
              choice: moderatorResult.choice,
              note: moderatorResult.note,
            });
          }
        } catch (err) {
          send({
            type: "moderator_error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      send({ type: "summary_start" });
      let polishedPrompt = "";
      try {
        const summaryResult = await callImageModeSummarizer(
          prompt,
          successfulResponses,
          moderatorReview,
          (text) => {
            polishedPrompt += text;
            send({ type: "summary_chunk", content: text });
          },
          (text) => send({ type: "summary_thinking_chunk", content: text }),
          streamContext,
        );
        const terminalError = toTerminalError(summaryResult);
        if (terminalError) {
          send({ type: "summary_error", error: terminalError });
          return; // Cannot proceed to image generation without polished prompt
        }
        send({ type: "summary_done" });
      } catch (err) {
        send({
          type: "summary_error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
        return;
      }

      // Now generate the image using the polished prompt
      if (!polishedPrompt.trim()) {
        send({
          type: "image_generation_error",
          error: "No polished prompt available",
        });
        return;
      }

      send({ type: "image_generation_start" });
      try {
        // Route the prompt to determine best image model
        const routing = await routeImagePrompt(polishedPrompt);
        send({
          type: "image_generation_routed",
          provider: routing.routingCategory,
          routingReason: routing.routingReason,
        });

        // Generate and persist the image
        if (!imageOwnerId) {
          imageOwnerId = getOrCreateAnonymousOwnerId(req);
        }
        const imageResult = await createGeneratedImage({
          ownerId: imageOwnerId,
          prompt: polishedPrompt,
          routingCategory: routing.routingCategory,
          routingReason: routing.routingReason,
        });

        if (!imageResult.success) {
          send({
            type: "image_generation_error",
            error: imageResult.error,
            blockReason: imageResult.blockReason,
          });
          return;
        }

        send({
          type: "image_generation_done",
          imageId: imageResult.image.id,
          provider: imageResult.image.provider,
          model: imageResult.image.model,
          routingReason: imageResult.image.routingReason,
        });
      } catch (err) {
        send({
          type: "image_generation_error",
          error: err instanceof Error ? err.message : "Image generation failed",
        });
      }
    } else {
      // Chat mode: use regular moderator and summarizer
      if (successfulResponses.length >= 2) {
        let moderatorReview: ModeratorReview | null = null;

        send({ type: "moderator_start" });
        try {
          const moderatorResult = await callModerator(
            history,
            prompt,
            successfulResponses,
            (text) => send({ type: "moderator_chunk", content: text }),
            streamContext,
          );
          const terminalError = toTerminalError(moderatorResult);
          if (terminalError) {
            send({ type: "moderator_error", error: terminalError });
          } else {
            moderatorReview = {
              rawOutput: moderatorResult.rawOutput,
              choice: moderatorResult.choice,
              note: moderatorResult.note,
            };
            send({
              type: "moderator_done",
              choice: moderatorResult.choice,
              note: moderatorResult.note,
            });
          }
        } catch (err) {
          send({
            type: "moderator_error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }

        send({ type: "summary_start" });
        try {
          const summaryResult = await callSummarizer(
            history,
            prompt,
            successfulResponses,
            moderatorReview,
            (text) => send({ type: "summary_chunk", content: text }),
            (text) => send({ type: "summary_thinking_chunk", content: text }),
            streamContext,
          );
          const terminalError = toTerminalError(summaryResult);
          if (terminalError) {
            send({ type: "summary_error", error: terminalError });
          } else {
            send({ type: "summary_done" });
          }
        } catch (err) {
          send({
            type: "summary_error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      } else if (successfulResponses.length === 1) {
        send({ type: "summary_start" });
        send({
          type: "summary_chunk",
          content: successfulResponses[0].response,
        });
        send({ type: "summary_done" });
      } else {
        send({ type: "summary_error", error: "No successful model responses" });
      }
    }
  } finally {
    send({ type: "done" });
    res.end();
  }
});

export default router;
