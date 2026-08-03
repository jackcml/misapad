/** Parse an optional top-level request-body object from settings. Keeping this
 * as JSON lets provider-specific controls evolve without growing a provider
 * matrix in the client. */
export function parseRequestExtras(raw: string, settingName: string): Record<string, unknown> {
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`${settingName} must be valid JSON${detail}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${settingName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
