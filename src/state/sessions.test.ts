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

const snap = (text: string, marks: Array<[number, number]> = []) => ({ text, marks });

describe("sessions", () => {
  it("creates, switches, autosaves, and deletes independent docs", async () => {
    vi.useFakeTimers();
    const s = await import("./sessions");

    const firstId = s.getSessions().currentId;
    s.scheduleAutosave(() => snap("first doc", [[0, 5]]));
    vi.advanceTimersByTime(600);
    expect(s.loadDoc(firstId)).toBe("first doc");
    expect(s.loadMarks(firstId)).toEqual([[0, 5]]);

    // A pending save is flushed under the OLD session before switching.
    s.scheduleAutosave(() => snap("first doc v2"));
    const secondId = s.createSession("second");
    expect(s.loadDoc(firstId)).toBe("first doc v2");
    expect(s.loadMarks(firstId)).toEqual([]);
    expect(s.getSessions().currentId).toBe(secondId);
    expect(s.loadDoc(secondId)).toBe("");
    expect(s.loadMarks(secondId)).toEqual([]);

    s.scheduleAutosave(() => snap("second doc", [[1, 4]]));
    s.flushAutosave();
    expect(s.loadDoc(secondId)).toBe("second doc");
    expect(s.loadMarks(secondId)).toEqual([[1, 4]]);

    s.switchSession(firstId);
    expect(s.getSessions().currentId).toBe(firstId);
    expect(s.loadDoc(firstId)).toBe("first doc v2");

    s.deleteSession(firstId);
    expect(s.getSessions().currentId).toBe(secondId);
    expect(s.loadDoc(firstId)).toBe("");
    expect(s.loadMarks(firstId)).toEqual([]);
    expect(s.getSessions().list[firstId]).toBeUndefined();

    // Deleting the last session leaves a fresh one.
    s.deleteSession(secondId);
    const freshId = s.getSessions().currentId;
    expect(freshId).not.toBe(secondId);
    expect(s.getSessions().list[freshId]).toBe("untitled");
    vi.useRealTimers();
  });

  it("tolerates a corrupt marks entry", async () => {
    const s = await import("./sessions");
    const id = s.getSessions().currentId;
    localStorage.setItem(`misapad.marks.${id}`, "{not json[");
    expect(s.loadMarks(id)).toEqual([]);
    localStorage.setItem(`misapad.marks.${id}`, '"a string"');
    expect(s.loadMarks(id)).toEqual([]);
  });
});
