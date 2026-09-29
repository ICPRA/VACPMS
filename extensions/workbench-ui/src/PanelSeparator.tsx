import { useRef } from "react";

export function PanelSeparator({ label, width, min, max, direction, onChange }: {
  label: string;
  width: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onChange: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const change = (value: number) => onChange(Math.max(min, Math.min(max, value)));
  return (
    <div
      className="wb-panel-separator"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) change(drag.current.width + direction * (event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          change(width + (event.key === "ArrowRight" ? 10 : -10) * direction);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          change(event.key === "Home" ? min : max);
        }
      }}
    />
  );
}
