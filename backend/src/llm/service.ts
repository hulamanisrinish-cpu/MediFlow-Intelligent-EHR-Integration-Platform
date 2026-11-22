import type { Patient, Recommendation } from "@mediflow/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { llmOutputs } from "../db/schema";
import type { Bindings } from "../env";
import { createLanguageModel } from "./adapter";
import {
  doctorBriefPrompt,
  recommendationPrompt,
  PROMPT_VERSIONS,
  type PromptKind,
} from "./prompts";

const MAX_OUTPUT_CHARS: Record<PromptKind, number> = {
  recommendation_explanation: 500,
  doctor_brief: 1_600,
};
const BRIEF_CATEGORIES = [
  "Allergies",
  "Abnormal results",
  "Previous diagnoses",
  "Current medications",
  "Recent tests",
  "Treatments",
] as const;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g;
const UNSAFE_OUTPUT = /(?:<\/?[a-z][^>]*>|javascript\s*:|data\s*:\s*text\/html|```)/i;

/**
 * Validates untrusted model output before it can be cached or shown. Invalid
 * output is rejected so the caller can use its deterministic fallback.
 */
export function validateGeneratedText(
  kind: PromptKind,
  raw: string,
): string | null {
  const normalized = raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "")
    .trim();

  if (normalized.length < 10 || normalized.length > MAX_OUTPUT_CHARS[kind]) {
    return null;
  }
  if (UNSAFE_OUTPUT.test(normalized)) return null;

  if (kind === "recommendation_explanation") {
    const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > 2) return null;
    return normalized;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== BRIEF_CATEGORIES.length) return null;
  for (const [index, category] of BRIEF_CATEGORIES.entries()) {
    const line = lines[index]!;
    const prefix = `${category}:`;
    if (!line.startsWith(prefix)) return null;
    if (line.slice(prefix.length).trim().length === 0) return null;
  }
  return normalized;
}

export function llmCacheKey(
  kind: PromptKind,
  patientId: string,
  sourceHash: string,
): string {
  return `${kind}:v${PROMPT_VERSIONS[kind]}:${patientId}:${sourceHash}`;
}

export function stableSourceHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function recommendationSourceHash(
  patient: Patient,
  recommendation: Recommendation,
): string {
  return stableSourceHash({
    promptVersion: PROMPT_VERSIONS.recommendation_explanation,
    patientId: patient.id,
    target: recommendation.nextResourceId,
    action: recommendation.actionText,
    reason: recommendation.reasonSummary,
    eta: recommendation.etaMin,
  });
}

export function doctorBriefSourceHash(patient: Patient): string {
  return stableSourceHash({
    promptVersion: PROMPT_VERSIONS.doctor_brief,
    formatVersion: 2,
    patientId: patient.id,
    history: patient.history,
  });
}

async function cachedContent(
  database: Database,
  patientId: string,
  kind: PromptKind,
  sourceHash: string,
): Promise<string | null> {
  const [cached] = await database
    .select({ content: llmOutputs.content })
    .from(llmOutputs)
    .where(
      and(
        eq(llmOutputs.patientId, patientId),
        eq(llmOutputs.kind, kind),
        eq(llmOutputs.sourceHash, sourceHash),
        eq(llmOutputs.promptVersion, PROMPT_VERSIONS[kind]),
      ),
    )
    .orderBy(desc(llmOutputs.id))
    .limit(1);
  return cached?.content ?? null;
}

async function generateAndCache(input: {
  database: Database;
  bindings: Bindings;
  patientId: string;
  kind: PromptKind;
  sourceHash: string;
  prompt: { system: string; prompt: string };
  fallbackApiKey?: string;
}): Promise<string | null> {
  const cached = await cachedContent(
    input.database,
    input.patientId,
    input.kind,
    input.sourceHash,
  );
  if (cached) return cached;
  const model = createLanguageModel(input.bindings, input.fallbackApiKey);
  if (!model) return null;
  try {
    const rawContent = await model.generate(input.prompt);
    const content = validateGeneratedText(input.kind, rawContent);
    if (!content) {
      console.warn(
        JSON.stringify({
          event: "llm_output_rejected",
          kind: input.kind,
          patientId: input.patientId,
          promptVersion: PROMPT_VERSIONS[input.kind],
        }),
      );
      return null;
    }
    await input.database
      .insert(llmOutputs)
      .values({
        cacheKey: llmCacheKey(input.kind, input.patientId, input.sourceHash),
        patientId: input.patientId,
        kind: input.kind,
        sourceHash: input.sourceHash,
        promptVersion: PROMPT_VERSIONS[input.kind],
        content,
        provider: model.provider,
        model: model.model,
      })
      .onConflictDoNothing({ target: llmOutputs.cacheKey });
    return content;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "llm_generation_failed",
        kind: input.kind,
        patientId: input.patientId,
        promptVersion: PROMPT_VERSIONS[input.kind],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

export async function explainRecommendation(input: {
  database: Database;
  bindings: Bindings;
  patient: Patient;
  recommendation: Recommendation;
  fallbackApiKey?: string;
}): Promise<string | null> {
  const sourceHash = recommendationSourceHash(
    input.patient,
    input.recommendation,
  );
  return generateAndCache({
    database: input.database,
    bindings: input.bindings,
    patientId: input.patient.id,
    kind: "recommendation_explanation",
    sourceHash,
    prompt: recommendationPrompt(input.patient, input.recommendation),
    fallbackApiKey: input.fallbackApiKey,
  });
}

export async function generateDoctorBrief(input: {
  database: Database;
  bindings: Bindings;
  patient: Patient;
  fallbackApiKey?: string;
}): Promise<string | null> {
  const sourceHash = doctorBriefSourceHash(input.patient);
  return generateAndCache({
    database: input.database,
    bindings: input.bindings,
    patientId: input.patient.id,
    kind: "doctor_brief",
    sourceHash,
    prompt: doctorBriefPrompt(input.patient),
    fallbackApiKey: input.fallbackApiKey,
  });
}
