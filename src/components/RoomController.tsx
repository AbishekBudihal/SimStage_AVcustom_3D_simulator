import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore, RoomSize } from "../workspace/DeviceStore";
export function RoomController({ store }: { store: DeviceStore }) {
  const room = useStore(store.api, (s) => s.room);
  return (
    <section className="panel-note" aria-label="Room parameters">
      <span className="eyebrow">LIVE ROOM PARAMETERS</span>
      {(["width", "depth", "height"] as const).map((axis) => (
        <label className="engineering-input" key={axis}>
          <span>
            {axis === "depth"
              ? "Length"
              : axis === "width"
                ? "Width"
                : "Height"}{" "}
            (m)
          </span>
          <RoomNumber
            label={`Room ${axis === "depth" ? "length" : axis} metres`}
            value={room[axis]}
            min={axis === "height" ? 2 : 3}
            max={axis === "height" ? 8 : 30}
            update={(n) => store.api.getState().setRoom({ [axis]: n })}
          />
        </label>
      ))}
      <label className="engineering-input">
        <span>Seating arrangement</span>
        <select
          aria-label="Seating arrangement"
          value={room.layout ?? "conference"}
          onChange={(e) =>
            store.api
              .getState()
              .setRoom({ layout: e.target.value as RoomSize["layout"] })
          }
        >
          <option value="conference">Conference table</option>
          <option value="huddle">Small meeting table</option>
          <option value="training">Training desks</option>
        </select>
      </label>
      <p className="muted fine-print">
        Metres. Seats use 0.85 m spacing; training desks use 3.6 × 1.6 m bays.
        Furniture clearance is a planning assumption.
      </p>
    </section>
  );
}

function RoomNumber({
  label,
  value,
  min,
  max,
  update,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  update: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      aria-label={label}
      type="number"
      step="0.1"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n) && n >= min && n <= max) update(n);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
