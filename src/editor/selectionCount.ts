import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

/** Match the string-length units used by the max-context setting. */
export function selectedCharacterCount(state: EditorState): number {
  return state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0);
}

class SelectionCountView {
  private readonly dom: HTMLDivElement;

  constructor(view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-selection-count";
    this.dom.setAttribute("aria-hidden", "true");
    view.dom.appendChild(this.dom);
    this.render(view);
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) this.render(update.view);
  }

  destroy() {
    this.dom.remove();
  }

  private render(view: EditorView) {
    const count = selectedCharacterCount(view.state);
    this.dom.hidden = count === 0;
    this.dom.textContent = count === 1 ? "1 char" : `${count.toLocaleString()} chars`;
  }
}

export const selectionCountExtension = ViewPlugin.fromClass(SelectionCountView);
