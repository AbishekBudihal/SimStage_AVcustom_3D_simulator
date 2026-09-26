import { ROOM_PRESETS, type RoomPresetId } from "../workspace/RoomPresets";
import { roomLayout, ROOM_TYPES, type RoomType } from "../workspace/RoomLayout";
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
              store.api.getState().setRoom({
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
      <details>
        <summary>Customize tables</summary>
        <label>
          <input
            type="checkbox"
            aria-label="Custom table dimensions"
            checked={!!room.table}
            onChange={(e) => {
              const layout = roomLayout(room),
                t = layout.tables[0];
              store.api
                .getState()
                .setRoom({
                  table: e.target.checked
                    ? {
                        width: t?.width ?? 1.6,
                        depth: t?.depth ?? 2,
                        height: t?.height ?? 0.75,
                        finish: "oak",
                        shape: "rounded",
                      }
                    : undefined,
                });
            }}
          />{" "}
          Use custom table settings
        </label>
        {room.table && (
          <>
            {(["width", "depth", "height"] as const).map((axis) => (
              <label className="engineering-input" key={axis}>
                <span>Table {axis === "depth" ? "length" : axis} (m)</span>
                <RoomNumber
                  label={`Table ${axis === "depth" ? "length" : axis} metres`}
                  value={room.table![axis]}
                  min={axis === "height" ? 0.55 : 0.6}
                  max={axis === "height" ? 1.2 : 20}
                  update={(n) =>
                    store.api
                      .getState()
                      .setRoom({ table: { ...room.table!, [axis]: n } })
                  }
                />
              </label>
            ))}
            <label className="engineering-input">
              <span>Finish</span>
              <select
                aria-label="Table finish"
                value={room.table.finish}
                onChange={(e) =>
                  store.api
                    .getState()
                    .setRoom({
                      table: {
                        ...room.table!,
                        finish: e.target.value as "oak" | "walnut" | "white",
                      },
                    })
                }
              >
                <option value="oak">Oak</option>
                <option value="walnut">Walnut</option>
                <option value="white">White</option>
              </select>
            </label>
            <label className="engineering-input">
              <span>Edges</span>
              <select
                aria-label="Table edges"
                value={room.table.shape}
                onChange={(e) =>
                  store.api
                    .getState()
                    .setRoom({
                      table: {
                        ...room.table!,
                        shape: e.target.value as "rounded" | "rectangular",
                      },
                    })
                }
              >
                <option value="rounded">Rounded</option>
                <option value="rectangular">Square</option>
              </select>
            </label>
            <p className="muted fine-print">
              Applies to every table. Dimensions are limited to available room
              clearance; seating and automatic equipment update together.
              Disable to restore automatic sizing.
            </p>
            <p>
              Effective table: {roomLayout(room).tableWidth.toFixed(2)} ×{" "}
              {roomLayout(room).tableDepth.toFixed(2)} m
            </p>
          </>
        )}
      </details>
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
