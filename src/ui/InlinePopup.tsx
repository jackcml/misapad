import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startGeneration } from "../gen/engine";
import { closePopup, popupStore, PopupState } from "./popupStore";
import { useKeyboard } from "./useKeyboard";

export default function InlinePopup() {
  const popup = popupStore.use();
  if (!popup) return null;
  // Keyed box so the input state resets every time the popup opens.
  return <PopupBox key={`${popup.x},${popup.y}`} popup={popup} />;
}

function PopupBox({ popup }: { popup: PopupState }) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // On touch devices, dock the popup above the on-screen keyboard instead of
  // anchoring it at the caret (which the keyboard would likely cover).
  const docked = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const keyboard = useKeyboard();

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
  const style: React.CSSProperties = docked
    ? keyboard.open
      ? { left: "0.5rem", right: "0.5rem", top: keyboard.bottom - 8, transform: "translateY(-100%)" }
      : { left: "0.5rem", right: "0.5rem", bottom: "calc(0.5rem + env(safe-area-inset-bottom))" }
    : { left: x, top: y };

  // Portal for modal-type render hoist
  return createPortal(
    <div className={docked ? "popup docked" : "popup"} style={style}>
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
