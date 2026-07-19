import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

function getVisualBottom(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.round(vv.offsetTop + vv.height);
}

/** On-screen keyboard state for pinning fixed UI above it.
 * `bottom` is the visual viewport's bottom edge in layout coordinates — the
 * only anchor that is correct in both keyboard modes (overlay and
 * resizes-content) and immune to the Android gap between window.innerHeight
 * and the visual viewport. `open` is a heuristic: anything shrinking the
 * visual viewport by >100px is the keyboard, not browser chrome. */
export function useKeyboard(): { open: boolean; bottom: number } {
  const bottom = useSyncExternalStore(subscribe, getVisualBottom, () => 0);
  const open = bottom > 0 && window.innerHeight - bottom > 100;
  return { open, bottom };
}
