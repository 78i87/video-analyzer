type ExtractedFields = {
  subconscious_thought?: string;
  curiosity_level?: number;
};

export function extractDecisionFields(text: string | null | undefined): ExtractedFields {
  if (!text) return {};

  const result: ExtractedFields = {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (parsed.subconscious_thought) {
        result.subconscious_thought = String(parsed.subconscious_thought);
      }
      if (typeof parsed.curiosity_level === "number") {
        result.curiosity_level = parsed.curiosity_level;
      }
      return result;
    }
  } catch {
  }

  const jsonMatch = text.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        if (parsed.subconscious_thought) {
          result.subconscious_thought = String(parsed.subconscious_thought);
        }
        if (typeof parsed.curiosity_level === "number") {
          result.curiosity_level = parsed.curiosity_level;
        }
      }
    } catch {
    }
  }

  return result;
}

export function mergeDecisionFields(
  primary: { subconscious_thought?: string | null; curiosity_level?: number | null },
  ...fallbacks: ExtractedFields[]
): { subconscious_thought: string | null; curiosity_level: number | null } {
  let subconscious: string | null = primary.subconscious_thought ?? null;
  let curiosity: number | null = primary.curiosity_level ?? null;

  for (const fallback of fallbacks) {
    if ((!subconscious || subconscious === "") && fallback.subconscious_thought) {
      subconscious = fallback.subconscious_thought;
    }
    if (curiosity === null && typeof fallback.curiosity_level === "number") {
      curiosity = fallback.curiosity_level;
    }
  }

  return { subconscious_thought: subconscious, curiosity_level: curiosity };
}
