import { useSyncExternalStore } from "react";

export type GenMode = "ask" | "prefill";
export type PrefillFlavor = "prefix-field" | "vllm" | "raw";

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxContextChars: number;
  mode: GenMode;
  prefillFlavor: PrefillFlavor;
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
  maxTokens: 512,
  maxContextChars: 24000,
  mode: "ask",
  prefillFlavor: "prefix-field",
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
