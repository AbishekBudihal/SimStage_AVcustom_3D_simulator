import type { DeviceStore, FurnitureEdit } from "../workspace/DeviceStore";
import { roomLayout } from "../workspace/RoomLayout";
import { useStore } from "zustand";

export function FurnitureInspector({
  store,
  selected,
}: {
  store: DeviceStore;
  selected: string | null;
}) {
  const room = useStore(store.api, (s) => s.room),
    layout = roomLayout(room);
  const table = selected?.startsWith("table:")
    ? layout.tables[Number(selected.slice(6))]
    : undefined;
  const seat = layout.seats.find((s) => `seat:${s.id}` === selected);
  const edit = (update: FurnitureEdit) => {
    if (selected)
      store.api
        .getState()
        .setRoom({
          furniture: {
            ...room.furniture,
            [selected]: { ...room.furniture?.[selected], ...update },
          },
        });
  };
  return (
    <section
      aria-label="Furniture inspector"
      className="mt-4 rounded-lg border border-solid border-sky-800 bg-slate-900 p-3"
    >
      <h3>Furniture editor</h3>
      {!table && !seat ? (
        <p>Select a table or chair in the room.</p>
      ) : (
        <>
          <strong>
            {table
              ? `Table ${Number(selected!.slice(6)) + 1}`
              : `Chair · ${seat!.id}`}
          </strong>
          <p className="text-xs text-slate-400">
            Drag to move · Shift: fine snap · Escape: cancel
          </p>
          {(
            [
              [
                "x",
                "Across room (m)",
                table?.x ?? seat!.position.x,
                -room.width / 2,
                room.width / 2,
              ],
              [
                "z",
                "Along room (m)",
                table?.z ?? seat!.position.z,
                -room.depth / 2,
                room.depth / 2,
              ],
              ...(table
                ? [
                    [
                      "width",
                      "Table width (m)",
                      table.width,
                      0.6,
                      room.width - 0.6,
                    ],
                    [
                      "depth",
                      "Table length (m)",
                      table.depth,
                      0.6,
                      room.depth - 0.6,
                    ],
                    ["height", "Table height (m)", table.height, 0.55, 1.2],
                  ]
                : []),
            ] as [keyof FurnitureEdit, string, number, number, number][]
          ).map(([key, label, value, min, max]) => (
            <label key={key} className="my-2 block text-xs">
              {label}
              <input
                aria-label={label}
                type="number"
                step="0.05"
                min={min}
                max={max}
                value={Number(value.toFixed(3))}
                className="ml-2 w-20 rounded border border-slate-600 bg-slate-800 p-1 text-white"
                onChange={(e) => {
                  const n = e.currentTarget.valueAsNumber;
                  if (Number.isFinite(n) && n >= min && n <= max)
                    edit({ [key]: n });
                }}
              />
            </label>
          ))}
          {seat && (
            <button
              onClick={() =>
                edit({
                  rotation: (seat.rotation + Math.PI / 4) % (2 * Math.PI),
                })
              }
            >
              Rotate chair 45°
            </button>
          )}
          <button
            className="mt-2 block"
            onClick={() => {
              const furniture = { ...room.furniture };
              delete furniture[selected!];
              store.api.getState().setRoom({ furniture });
            }}
          >
            Reset this object
          </button>
          <p className="text-xs text-slate-400">
            Tables carry generated seats and automatic tabletop devices.
            Individually moved chairs and devices stay independent. Overlaps are
            not prevented.
          </p>
        </>
      )}
      <button
        className="mt-2"
        disabled={!Object.keys(room.furniture ?? {}).length}
        onClick={() => store.api.getState().setRoom({ furniture: {} })}
      >
        Reset furniture layout
      </button>
    </section>
  );
}
