import { ROOM_PRESETS, type RoomPresetId } from "../workspace/RoomPresets";
import { ROOM_TYPES, type RoomType } from "../workspace/RoomLayout";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore, RoomSize } from "../workspace/DeviceStore";
export function RoomController({ store }: { store: DeviceStore }) {
  const room = useStore(store.api, (s) => s.room);
  return (
    <section className="panel-note" aria-label="Room parameters">
      <span className="eyebrow">LIVE ROOM PARAMETERS</span>
      <label className="engineering-input">
        <span>Starting defaults</span>
        <select
          aria-label="Starting room defaults"
          value=""
          onChange={(e) => {
            const id = e.target.value as RoomPresetId;
            const preset = ROOM_PRESETS[id];
            if (preset)
              store.api
                .getState()
                .setRoom({
                  ...preset.room,
                  capacity: id === "huddle" ? 4 : id === "training" ? 24 : 12,
                  roomType:
                    id === "huddle"
                      ? "Huddle Room"
                      : id === "training"
                        ? "Training Room"
                        : "Boardroom",
                });
          }}
        >
          <option value="">Choose defaults...</option>
          {Object.entries(ROOM_PRESETS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
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
        <span>Room type</span>
        <select
          aria-label="Room type"
          value={
            room.roomType ??
            (room.layout === "training"
              ? "Training Room"
              : room.layout === "huddle"
                ? "Huddle Room"
                : "Conference Room")
          }
          onChange={(e) =>
            store.api
              .getState()
              .setRoom({ roomType: e.target.value as RoomType })
          }
        >
          {ROOM_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="engineering-input">
        <span>Requested seats</span>
        <input
          aria-label="Requested seats"
          type="number"
          min="0"
          max="200"
          step="1"
          placeholder="Automatic"
          value={room.capacity ?? ""}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isInteger(n) && n >= 0 && n <= 200)
              store.api.getState().setRoom({ capacity: n });
          }}
        />
      </label>
      <button
        onClick={() => store.api.getState().setRoom({ capacity: undefined })}
      >
        Fit seats to available space
      </button>
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
