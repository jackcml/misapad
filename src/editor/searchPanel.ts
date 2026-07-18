import { EditorView, ViewPlugin } from "@codemirror/view";

class SearchPanelFocus {
  private readonly onClick: (event: MouseEvent) => void;
  private readonly viewDOM: HTMLElement;

  constructor(view: EditorView) {
    this.viewDOM = view.dom;
    this.onClick = (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('.cm-search button[name="select"]')
      ) {
        // The button's own click handler has already created the selections.
        // Return keyboard control to the document so they can be edited at once.
        view.focus();
      }
    };
    view.dom.addEventListener("click", this.onClick);
  }

  destroy() {
    this.viewDOM.removeEventListener("click", this.onClick);
  }
}

export const searchPanelFocusExtension = ViewPlugin.fromClass(SearchPanelFocus);
