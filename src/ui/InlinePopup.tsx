import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startGeneration } from "../gen/engine";
import { closePopup, popupStore, PopupState } from "./popupStore";

export default function InlinePopup() {
  const popup = popupStore.use();
  if (!popup) return null;
  // Keyed box so the input state resets every time the popup opens.
  return <PopupBox key={`${popup.x},${popup.y}`} popup={popup} />;
}

function PopupBox({ popup }: { popup: PopupState }) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = () => {
    closePopup();
    popup.view.focus();
  };

  const submit = () => {
    const text = instruction.trim();
    close();
    if (text) void startGeneration(popup.view, "popup", { instruction: text });
  };

  const x = Math.min(popup.x, window.innerWidth - 340);
  const y = Math.min(popup.y + 6, window.innerHeight - 60);

  return createPortal(
    <div className="popup" style={{ left: x, top: y }}>
      <input
        ref={inputRef}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") close();
        }}
        onBlur={close}
        placeholder={popup.hasSelection ? "Rewrite selection…" : "Insert here…"}
      />
    </div>,
    document.body,
  );
}
