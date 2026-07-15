import { useEffect, useRef } from "react";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseExtensions } from "./setup";

interface EditorProps {
  initialDoc: string;
  extensions?: Extension[];
  onViewReady: (view: EditorView) => void;
}

export default function Editor({ initialDoc, extensions = [], onViewReady }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: baseExtensions(extensions),
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;
    onViewReady(view);
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; doc/extension changes after mount go through the view directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="editor" />;
}
