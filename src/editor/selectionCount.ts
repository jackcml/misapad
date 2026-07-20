import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { generatedMarks } from "./generatedMarks";

/** Match the string-length units used by the max-context setting. */
export function selectedCharacterCount(state: EditorState): number {
  return state.selection.ranges.reduce((total, range) => total + range.to - range.from, 0);
}

export interface CharacterStats {
  count: number;
  generatedCount: number;
  generatedPercentage: number;
  isSelection: boolean;
}

/** Counts characters and model-generated tint in the current selection, or
 * across the whole document when there is no selection. */
export function characterStats(state: EditorState): CharacterStats {
  const selectedCount = selectedCharacterCount(state);
  const isSelection = selectedCount > 0;
  const ranges = isSelection ? state.selection.ranges : [{ from: 0, to: state.doc.length }];
  const marks = state.field(generatedMarks, false);
  let generatedCount = 0;

  if (marks) {
    for (const range of ranges) {
      marks.between(range.from, range.to, (from, to) => {
        generatedCount += Math.max(0, Math.min(to, range.to) - Math.max(from, range.from));
      });
    }
  }

  const count = isSelection ? selectedCount : state.doc.length;
  return {
    count,
    generatedCount,
    generatedPercentage: count === 0 ? 0 : Math.round((generatedCount / count) * 100),
    isSelection,
  };
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
    const { count, generatedPercentage } = characterStats(view.state);
    const countLabel = count === 1 ? "1 char" : `${count.toLocaleString()} chars`;
    this.dom.textContent = `${countLabel} · ${generatedPercentage}% model`;
  }
}

export const selectionCountExtension = ViewPlugin.fromClass(SelectionCountView);
