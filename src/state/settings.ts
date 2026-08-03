import { useSyncExternalStore } from "react";

export type GenMode = "ask" | "prefill";
export type PrefillFlavor = "prefix-field" | "vllm" | "raw";

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  continueMaxTokens: number;
  popupMaxTokens: number;
  maxContextChars: number;
  mode: GenMode;
  prefillFlavor: PrefillFlavor;
  askExtraBody: string;
  popupExtraBody: string;
  systemPromptAsk: string;
  systemPromptPrefill: string;
  userPromptPrefill: string;
  systemPromptPopup: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  model: "",
  temperature: 0.8,
  continueMaxTokens: 512,
  popupMaxTokens: 2048,
  maxContextChars: 24000,
  mode: "ask",
  prefillFlavor: "prefix-field",
  askExtraBody: "",
  popupExtraBody: "",
  systemPromptAsk:
    "You are a co-writer. The user will send an unfinished piece of writing. " +
    "Continue it from exactly where it stops. Match the style, tone, tense, and formatting. " +
    "Output ONLY the continuation — no preamble, no quotation marks, no commentary. " +
    "If the text stops mid-sentence, continue the sentence. Begin your output with the exact " +
    "next characters, including a leading space or newline if appropriate.",
  systemPromptPrefill: "",
  userPromptPrefill: "Continue the following text.",
  systemPromptPopup:
    "You are a precise text-editing assistant. You receive a document with either an insertion " +
    "marker <INSERT_HERE/> or a region wrapped in <REWRITE>...</REWRITE>, plus an instruction. " +
    "Reply with ONLY the raw text that should appear at the marker (or replace the region). " +
    "Never repeat the surrounding text, never add explanations, quotes, or code fences.",
};

const STORAGE_KEY = "misapad.settings";

function load(): Settings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> & { maxTokens?: unknown };
    // maxTokens was the single budget used by every request. Preserve it as
    // the continuation budget while giving Ctrl+K its own, roomier default.
    const { maxTokens: legacyMaxTokens, ...stored } = parsed;
    const continueMaxTokens =
      typeof stored.continueMaxTokens === "number"
        ? stored.continueMaxTokens
        : typeof legacyMaxTokens === "number"
          ? legacyMaxTokens
          : DEFAULT_SETTINGS.continueMaxTokens;
    return { ...DEFAULT_SETTINGS, ...stored, continueMaxTokens };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // quota/private-mode failures shouldn't break the app
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
