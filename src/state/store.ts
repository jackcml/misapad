import { useSyncExternalStore } from "react";

/** Minimal external store: module-level state that React can subscribe to.
 * Use for state that naturally lives outside of components, e.g., statusStore
 * set in gen/engine but subscribed to by multiple bar components.
*/
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    use(): T {
      return useSyncExternalStore(
        (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => value,
      );
    },
  };
}
