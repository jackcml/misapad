import { EditorView } from "@codemirror/view";
import { createStore } from "../state/store";

export interface PopupState {
  view: EditorView;
  /** Viewport coordinates (used with position: fixed). */
  x: number;
  y: number;
  hasSelection: boolean;
}

export const popupStore = createStore<PopupState | null>(null);

export function openPopup(view: EditorView) {
  const sel = view.state.selection.main;
  const coords = view.coordsAtPos(sel.head);
  const rect = view.dom.getBoundingClientRect();
  popupStore.set({
    view,
    x: coords?.left ?? rect.left + 40,
    y: coords?.bottom ?? rect.top + 40,
    hasSelection: !sel.empty,
  });
}

export function closePopup() {
  popupStore.set(null);
}
