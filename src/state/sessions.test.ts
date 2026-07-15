import { beforeAll, describe, expect, it, vi } from "vitest";

// Minimal localStorage for node before sessions.ts is imported.
beforeAll(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
});

describe("sessions", () => {
  it("creates, switches, autosaves, and deletes independent docs", async () => {
    vi.useFakeTimers();
    const s = await import("./sessions");

    const firstId = s.getSessions().currentId;
    s.scheduleAutosave(() => "first doc");
    vi.advanceTimersByTime(600);
    expect(s.loadDoc(firstId)).toBe("first doc");

    // A pending save is flushed under the OLD session before switching.
    s.scheduleAutosave(() => "first doc v2");
    const secondId = s.createSession("second");
    expect(s.loadDoc(firstId)).toBe("first doc v2");
    expect(s.getSessions().currentId).toBe(secondId);
    expect(s.loadDoc(secondId)).toBe("");

    s.scheduleAutosave(() => "second doc");
    s.flushAutosave();
    expect(s.loadDoc(secondId)).toBe("second doc");

    s.switchSession(firstId);
    expect(s.getSessions().currentId).toBe(firstId);
    expect(s.loadDoc(firstId)).toBe("first doc v2");

    s.deleteSession(firstId);
    expect(s.getSessions().currentId).toBe(secondId);
    expect(s.loadDoc(firstId)).toBe("");
    expect(s.getSessions().list[firstId]).toBeUndefined();

    // Deleting the last session leaves a fresh one.
    s.deleteSession(secondId);
    const freshId = s.getSessions().currentId;
    expect(freshId).not.toBe(secondId);
    expect(s.getSessions().list[freshId]).toBe("untitled");
    vi.useRealTimers();
  });
});
