/** Defends popup-mode output against models that echo their surroundings:
 * strips a leading/trailing code fence and any overlap with the text just
 * before/after the insertion point. Holds back a small buffer at each end so
 * trimming works without giving up streaming. */

const LEAD_HOLD = 96; // chars withheld before the first emit
const TAIL_HOLD = 48; // chars withheld until the stream ends
const MIN_OVERLAP = 12; // shorter matches are treated as coincidence

/** Longest k >= MIN_OVERLAP where the end of `a` equals the start of `b`. */
function overlap(a: string, b: string): number {
  for (let k = Math.min(a.length, b.length); k >= MIN_OVERLAP; k--) {
    if (a.slice(a.length - k) === b.slice(0, k)) return k;
  }
  return 0;
}

function trimLeading(buf: string, beforeTail: string): string {
  buf = buf.replace(/^\s*```[^\n]*\n/, "");
  const k = overlap(beforeTail, buf);
  return buf.slice(k);
}

function trimTrailing(buf: string, afterHead: string): string {
  buf = buf.replace(/\n?```\s*$/, "");
  const k = overlap(buf, afterHead);
  return buf.slice(0, buf.length - k);
}

export async function* trimEcho(
  source: AsyncIterable<string>,
  beforeTail: string,
  afterHead: string,
): AsyncGenerator<string> {
  let buf = "";
  let leadDone = false;
  for await (const chunk of source) {
    buf += chunk;
    if (!leadDone) {
      if (buf.length < LEAD_HOLD) continue;
      buf = trimLeading(buf, beforeTail);
      leadDone = true;
    }
    if (buf.length > TAIL_HOLD) {
      yield buf.slice(0, buf.length - TAIL_HOLD);
      buf = buf.slice(buf.length - TAIL_HOLD);
    }
  }
  if (!leadDone) buf = trimLeading(buf, beforeTail);
  buf = trimTrailing(buf, afterHead);
  if (buf) yield buf;
}
