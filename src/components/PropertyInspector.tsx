import { useStore } from "zustand";
import {
  DeviceStore,
  snapToSurface,
  type RoomSize,
  type MountSurface,
} from "../workspace/DeviceStore";
import { allowedSurfaces } from "../workspace/LegacyCatalog";

const button =
  "rounded-md border border-solid border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700";
export function PropertyInspector({
  store,
  room,
}: {
  store: DeviceStore;
  room: RoomSize;
}) {
  const catalog = useStore(store.api, (state) => state.catalog);
  const selected = useStore(store.api, (state) =>
    state.selectedId ? state.devices[state.selectedId] : undefined,
  );
  if (!selected)
    return (
      <section className="mt-6 border-0 border-t border-solid border-slate-700 pt-4">
        <h3>Device inspector</h3>
        <p className="text-xs leading-relaxed text-slate-400">
          Select a device to adjust its orientation and mounting height.
        </p>
      </section>
    );
  const profile = catalog.find((p) => p.id === selected.catalogId);
  const wall = !["floor", "ceiling", "table"].includes(selected.surface);
  const degrees = ((((selected.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
  const shift = (delta: number) =>
    store.update(selected.id, {
      position: {
        y: Math.min(
          room.height,
          Math.max(0, Math.round((selected.position.y + delta) * 100) / 100),
        ),
      },
    });
  return (
    <section
      className="mt-6 border-0 border-t border-solid border-slate-700 pt-4"
      aria-label="Device inspector"
    >
      <h3>Device inspector</h3>
      <strong className="text-sm">{selected.metadata.label}</strong>
      <p className="text-xs text-slate-400">{selected.surface} mount</p>
      {profile && (
        <details className="engineering-settings">
          <summary>Hardware specifications & sources</summary>
          <p className="muted fine-print">
            W / H / D:{" "}
            {Object.values(profile.dimensions)
              .map((n) => (n * 1000).toFixed(2))
              .join(" / ")}{" "}
            mm
          </p>
          <p className="muted fine-print">
            Power: {selected.metadata.powerBasis}
          </p>
          <p className="muted fine-print">
            Heat: {selected.metadata.heatBasis}
          </p>
          <p className="muted fine-print">{profile.notes}</p>
          <p className="muted fine-print">
            {profile.sourceFile} · {profile.provenance}
          </p>
          <p className="muted fine-print">{profile.source}</p>
          <details>
            <summary className="text-xs">Original catalog record</summary>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(profile.raw, null, 2)}
            </pre>
          </details>
        </details>
      )}
      {selected.metadata.sensitivityDb !== undefined && (
        <label className="engineering-input">
          <span>Assumed amplifier drive (W)</span>
          <input
            aria-label="Amplifier drive watts"
            type="number"
            min="0"
            max={selected.metadata.maxSpeakerWatts}
            step="0.1"
            value={selected.metadata.speakerWatts ?? 1}
            onChange={(e) => {
              const watts = Number(e.target.value);
              if (
                Number.isFinite(watts) &&
                watts >= 0 &&
                watts <= (selected.metadata.maxSpeakerWatts ?? Infinity)
              )
                store.update(selected.id, {
                  metadata: { speakerWatts: watts },
                });
            }}
          />
        </label>
      )}

      <label className="engineering-input">
        <span>Mounting surface</span>
        <select
          value={selected.surface}
          onChange={(event) => {
            const surface = event.target.value as MountSurface;
            store.update(selected.id, {
              surface,
              position: snapToSurface(selected.position, surface, room),
            });
          }}
        >
          {(profile?.surfaces ?? allowedSurfaces(selected.kind)).map(
            (surface) => (
              <option key={surface} value={surface}>
                {surface}
              </option>
            ),
          )}
        </select>
      </label>
      <div className="my-4 grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} className="rounded bg-slate-800 p-2 text-xs">
            <span className="block text-slate-400">{axis.toUpperCase()}</span>
            {selected.position[axis].toFixed(2)} m
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">Rotation around vertical axis</p>
      <div className="grid grid-cols-4 gap-1">
        {[0, 90, 180, 270].map((angle) => (
          <button
            key={angle}
            className={button}
            aria-pressed={Math.abs(degrees - angle) < 0.01}
            onClick={() =>
              store.update(selected.id, {
                rotation: { y: (angle * Math.PI) / 180 },
              })
            }
          >
            {angle}°
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-400">Height offset</p>
      <div className="flex gap-2">
        <button
          className={button}
          disabled={!wall || selected.position.y <= 0}
          onClick={() => shift(-0.5)}
        >
          − 0.5 m
        </button>
        <button
          className={button}
          disabled={!wall || selected.position.y >= room.height}
          onClick={() => shift(0.5)}
        >
          + 0.5 m
        </button>
      </div>
      {!wall && (
        <p className="text-xs leading-relaxed text-slate-500">
          Height is fixed to the {selected.surface} mounting plane.
        </p>
      )}
      {(
        [
          "powerWatts",
          "heatBtuPerHour",
          "rackUnits",
          ...(selected.kind === "display" ? ["imageHeightM"] : []),
          ...(selected.kind === "speaker" &&
          selected.metadata.sensitivityDb === undefined
            ? ["splAt1m"]
            : []),
        ] as const
      ).map((key) => {
        const field = key as
          | "powerWatts"
          | "heatBtuPerHour"
          | "rackUnits"
          | "imageHeightM"
          | "splAt1m";
        const label = {
          powerWatts: "Power (W)",
          heatBtuPerHour: "Heat (BTU/h)",
          rackUnits: "Rack units",
          imageHeightM: "Image height (m)",
          splAt1m: "Reference SPL at 1 m (dB)",
        }[field];
        return (
          <label className="engineering-input" key={field}>
            <span>{label}</span>
            <input
              type="number"
              min={field === "imageHeightM" ? 0.1 : 0}
              max={field === "splAt1m" ? 150 : undefined}
              step={field === "imageHeightM" ? 0.1 : 1}
              placeholder="Unknown"
              value={selected.metadata[field] ?? ""}
              onChange={(event) => {
                const value =
                  event.target.value === "" ? null : Number(event.target.value);
                if (field === "imageHeightM" && (value === null || value <= 0))
                  return;
                if (
                  value !== null &&
                  (!Number.isFinite(value) ||
                    value < 0 ||
                    (field === "splAt1m" && value > 150))
                )
                  return;
                store.update(selected.id, {
                  metadata: {
                    [field]: value,
                    ...(field === "powerWatts"
                      ? { powerBasis: "User override" }
                      : {}),
                    ...(field === "heatBtuPerHour"
                      ? { heatBasis: "User override" }
                      : {}),
                  },
                });
              }}
            />
          </label>
        );
      })}
      <button
        className="mt-5 w-full rounded-md border border-solid border-rose-900 bg-transparent py-2 text-xs text-rose-300 hover:bg-rose-950"
        onClick={() => store.remove(selected.id)}
      >
        Delete device
      </button>
    </section>
  );
}
