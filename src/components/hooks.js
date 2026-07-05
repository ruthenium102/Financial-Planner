// Shared UI hooks (kept out of component files so react-refresh stays happy).
import { useState, useEffect, useRef } from "react";
import { C } from "../theme.js";

// Click-outside collapse: assigns a ref; when a click happens outside the ref'd
// element, calls onOutside. Used for expandable rows.
function useClickOutside(active, onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    // Use mousedown so it fires before click handlers that might re-expand
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onOutside]);
  return ref;
}

// ===== Drag-to-reorder hook =====
// Returns { dragProps, isDragging, isDragOver } for each row index.
// Caller passes the array and a setter; the hook handles drag state and reorder logic.
// Native HTML5 drag-and-drop — no library; desktop-friendly.
function useDragReorder(items, onReorder) {
  const [draggingIdx, setDraggingIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const handlersFor = (idx) => ({
    draggable: true,
    onDragStart: (e) => {
      setDraggingIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      // Some browsers require setData to start a drag
      try { e.dataTransfer.setData("text/plain", String(idx)); } catch {}
    },
    onDragOver: (e) => {
      e.preventDefault(); // required to allow drop
      e.dataTransfer.dropEffect = "move";
      if (overIdx !== idx) setOverIdx(idx);
    },
    onDragLeave: () => {
      // Don't clear overIdx here — onDragOver on the next row will replace it
    },
    onDrop: (e) => {
      e.preventDefault();
      if (draggingIdx == null || draggingIdx === idx) {
        setDraggingIdx(null); setOverIdx(null); return;
      }
      const next = items.slice();
      const [moved] = next.splice(draggingIdx, 1);
      const insertAt = idx > draggingIdx ? idx - 1 : idx;
      next.splice(insertAt, 0, moved);
      onReorder(next);
      setDraggingIdx(null); setOverIdx(null);
    },
    onDragEnd: () => {
      setDraggingIdx(null); setOverIdx(null);
    },
    style: {
      opacity: draggingIdx === idx ? 0.4 : 1,
      borderTop: overIdx === idx && draggingIdx != null && draggingIdx > idx ? `2px solid ${C.accent}` : undefined,
      borderBottom: overIdx === idx && draggingIdx != null && draggingIdx < idx ? `2px solid ${C.accent}` : undefined,
    },
  });

  return { handlersFor, draggingIdx };
}

// Generic sortable list wrapper. Renders each item with a drag handle and supports
// HTML5 drag-and-drop reordering. The render fn receives the item (no special props).

export { useClickOutside, useDragReorder };
