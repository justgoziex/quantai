import { existsSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

/*
  AI provider for the analysis panel — streaming, so the readout appears as
  it's written. Priority order:
  1. Vertex AI Gemini  — GOOGLE_CLOUD_PROJECT (+ service-account/ADC creds)
                         or GOOGLE_VERTEX_API_KEY. GCP billing ($300 credit).
  2. Gemini API        — GEMINI_API_KEY (aistudio.google.com)
  3. Claude            — ANTHROPIC_API_KEY (console.anthropic.com)
*/
// "latest" alias tracks the current stable Flash, so this won't go stale as
// Google rotates models (gemini-2.5-flash is now gated for new keys).
const GEMINI_MODEL = "gemini-flash-latest";

export type AiProvider = "groq" | "vertex" | "gemini" | "claude";

export type AiStream =
  | {
      ok: true;
      provider: AiProvider;
      /* async generator of text chunks */
      chunks: AsyncGenerator<string>;
    }
  | { ok: false; status: number; error: string };

/*
  Serverless has no persistent filesystem, so a service-account key can't be a
  file on disk. Instead we accept the JSON as GOOGLE_SERVICE_ACCOUNT_JSON, write
  it to /tmp once per cold start, and point ADC at it. Local dev keeps using the
  GOOGLE_APPLICATION_CREDENTIALS file path directly.
*/
const SA_TMP_PATH = "/tmp/quantai-vertex-sa.json";
function ensureVertexCreds(): void {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return;
  try {
    if (!existsSync(SA_TMP_PATH)) writeFileSync(SA_TMP_PATH, json, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = SA_TMP_PATH;
  } catch {
    /* if /tmp isn't writable the provider chain falls through to the next */
  }
}

/*
  Whether the run can actually search the web.

  Only Vertex has grounding; Groq and the free Gemini key have no search tool
  at all. The analysis prompt used to instruct the model to research online
  regardless, which worked purely by luck — llama-3.3-70b ignored the
  instruction and wrote the read anyway. Models that take instructions
  literally instead emit search directives and stop, so the analysis came back
  as raw tool-call markup.

  The prompt now asks for research only when research is possible.
*/
export function webSearchAvailable(): boolean {
  return vertexConfigured();
}

function vertexConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_VERTEX_API_KEY ||
      (process.env.GOOGLE_CLOUD_PROJECT &&
        (process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
          process.env.GOOGLE_GENAI_USE_ADC === "1")),
  );
}

export function aiConfigured(): boolean {
  return Boolean(
    process.env.GROQ_API_KEY ||
      vertexConfigured() ||
      process.env.GEMINI_API_KEY ||
      process.env.ANTHROPIC_API_KEY,
  );
}

export async function streamAnalysis(system: string, user: string): Promise<AiStream> {
  const attempts: Array<() => Promise<AiStream>> = [];
  // Groq first — a real free tier (thousands/day) that streams reliably.
  if (process.env.GROQ_API_KEY) attempts.push(() => viaGroq(system, user));
  if (vertexConfigured()) attempts.push(() => viaGoogle(system, user, "vertex"));
  if (process.env.GEMINI_API_KEY) attempts.push(() => viaGoogle(system, user, "gemini"));
  if (process.env.ANTHROPIC_API_KEY) attempts.push(() => viaClaude(system, user));

  if (attempts.length === 0) {
    return {
      ok: false,
      status: 503,
      error:
        "AI analysis isn't configured. Set GROQ_API_KEY (free — console.groq.com), or GEMINI_API_KEY / Vertex — see .env.example.",
    };
  }

  // Try providers in order; each primes its first token, so a dead provider
  // (bad key, no credits, quota) fails cleanly and we fall through to the next
  // instead of emitting a half-broken stream.
  let last: AiStream = { ok: false, status: 502, error: "Analysis failed — try again." };
  for (const attempt of attempts) {
    last = await attempt();
    if (last.ok) return last;
  }
  return last;
}

/*
  Pull the first token before we commit to streaming. If the provider errors
  during setup or on the first chunk (auth, credits, quota), we surface a clean
  error instead of a broken stream. The buffered first token is re-yielded.
*/
async function primeStream(
  gen: AsyncGenerator<string>,
  provider: AiProvider,
  onError: (e: unknown) => AiStream,
): Promise<AiStream> {
  const iter = gen[Symbol.asyncIterator]();
  try {
    let first = await iter.next();
    // wait past any empty leading chunks (e.g. thinking with no text yet)
    while (!first.done && !first.value) first = await iter.next();
    // a stream that completes with NO text is a failure (e.g. wrong model on a
    // provider, or a safety block) — surface it so we fall through to the next
    // provider instead of returning a blank analysis.
    if (first.done) return onError(new Error("empty response from provider"));
    async function* out(): AsyncGenerator<string> {
      if (first.value) yield first.value;
      for (let n = await iter.next(); !n.done; n = await iter.next()) {
        if (n.value) yield n.value;
      }
    }
    return { ok: true, provider, chunks: out() };
  } catch (e) {
    return onError(e);
  }
}

/*
  Groq — OpenAI-compatible, genuinely free tier with a real daily quota, and
  fast streaming. Default model is a strong 70B for analysis quality.
*/
function groqError(status: number, msg: string): AiStream {
  if (status === 401 || status === 403) return { ok: false, status: 503, error: "The Quant AI engine key was rejected." };
  if (status === 429) return { ok: false, status: 429, error: "Quant AI engine is busy — try again in a minute." };
  console.error("groq analyze failed:", status, msg.slice(0, 200));
  return { ok: false, status: 502, error: "Analysis failed — try again." };
}

async function viaGroq(system: string, user: string): Promise<AiStream> {
  const key = process.env.GROQ_API_KEY!;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.4,
        max_tokens: 2600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      return groqError(r.status, t);
    }
    const chunks = (async function* () {
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const t = JSON.parse(data)?.choices?.[0]?.delta?.content;
            if (t) yield t as string;
          } catch {
            /* skip keep-alive / partial */
          }
        }
      }
    })();
    return primeStream(chunks, "groq", (e) => groqError(500, (e as Error).message ?? String(e)));
  } catch (e) {
    return groqError(500, (e as Error).message ?? String(e));
  }
}

function googleError(msg: string, provider: "vertex" | "gemini"): AiStream {
  if (/401|403|UNAUTHENTICATED|PERMISSION_DENIED|API key not valid|credentials/i.test(msg)) {
    return { ok: false, status: 503, error: "The Quant AI engine key was rejected." };
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return { ok: false, status: 429, error: "Quant AI engine is busy — try again in a minute." };
  }
  console.error(`${provider} analyze failed:`, msg);
  return { ok: false, status: 502, error: "Analysis failed — try again." };
}

async function viaGoogle(
  system: string,
  user: string,
  provider: "vertex" | "gemini",
): Promise<AiStream> {
  // Live web-search grounding is a paid Vertex capability — the free Gemini
  // API (aistudio key) returns 429 RESOURCE_EXHAUSTED on it, which used to
  // waste quota and knock analysis over. So only attempt grounding on Vertex;
  // the free Gemini key goes straight to a plain (ungrounded) call.
  if (provider === "vertex") {
    const grounded = await tryGoogle(system, user, provider, true);
    if (grounded.ok) return grounded;
    console.error("vertex grounded analyze failed, retrying without grounding");
  }
  return tryGoogle(system, user, provider, false);
}

async function tryGoogle(
  system: string,
  user: string,
  provider: "vertex" | "gemini",
  ground: boolean,
): Promise<AiStream> {
  try {
    if (provider === "vertex" && !process.env.GOOGLE_VERTEX_API_KEY) ensureVertexCreds();
    const ai =
      provider === "vertex"
        ? process.env.GOOGLE_VERTEX_API_KEY
          ? new GoogleGenAI({ vertexai: true, apiKey: process.env.GOOGLE_VERTEX_API_KEY })
          : new GoogleGenAI({
              vertexai: true,
              project: process.env.GOOGLE_CLOUD_PROJECT!,
              location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
            })
        : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // Non-streaming: gemini-flash-latest (a thinking model) streams empty text
    // parts, so we take the full response and hand it back as one chunk. The
    // free tier is tiny (~20/day) — Groq is the primary; this is a fallback.
    const resp = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: user,
      config: {
        systemInstruction: system,
        maxOutputTokens: 3500,
        temperature: 0.4,
        ...(ground ? { tools: [{ googleSearch: {} }] } : {}),
        thinkingConfig: { thinkingBudget: 128 },
      },
    });
    const full = resp.text ?? "";
    const chunks = (async function* () {
      if (full) yield full;
    })();
    return primeStream(chunks, provider, (e) =>
      googleError((e as Error).message ?? String(e), provider),
    );
  } catch (e) {
    return googleError((e as Error).message ?? String(e), provider);
  }
}

function claudeError(e: unknown): AiStream {
  if (e instanceof Anthropic.AuthenticationError) {
    return { ok: false, status: 503, error: "The Quant AI engine key is invalid." };
  }
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return {
      ok: false,
      status: 503,
      error: "The Quant AI engine is out of capacity — top up the engine key to resume analysis.",
    };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { ok: false, status: 429, error: "Quant AI engine is busy — try again in a minute." };
  }
  console.error("claude analyze failed:", (e as Error).message);
  return { ok: false, status: 502, error: "Analysis failed — try again." };
}

async function viaClaude(system: string, user: string): Promise<AiStream> {
  const client = new Anthropic();
  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages: [{ role: "user", content: user }],
    });

    const chunks = (async function* () {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    })();
    return primeStream(chunks, "claude", claudeError);
  } catch (e) {
    return claudeError(e);
  }
}
