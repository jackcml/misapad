import { useEffect, useRef } from "react";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { baseExtensions } from "./setup";

interface EditorProps {
  initialDoc: string;
  initialMarks?: Array<[number, number]>;
  extensions?: Extension[];
  onViewReady: (view: EditorView) => void;
}

export default function Editor({
  initialDoc,
  initialMarks = [],
  extensions = [],
  onViewReady,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: baseExtensions(extensions, initialMarks),
      }),
      parent: containerRef.current!,
    });
    onViewReady(view);
    view.focus();
    return () => {
      view.destroy();
    };
    // Mount once; doc/extension changes after mount go through the view directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="editor" />;
}
