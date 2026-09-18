import { useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import type { OpticalResult } from "../workspace/OpticalEngineering";
import { eyeHeight } from "../workspace/RoomLayout";
import { opticalMetadata, specificationText } from "../workspace/CatalogQuery";
export function OpticalAnalysisPanel({
  store,
  mode,
  result,
  selectedSeat,
  selectSeat,
}: {
  store: DeviceStore;
  mode: "camera" | "display";
  result?: OpticalResult;
  selectedSeat: string | null;
  selectSeat: (id: string) => void;
}) {
  const devices = useStore(store.api, (s) => s.devices),
    catalog = useStore(store.api, (s) => s.catalog),
    room = useStore(store.api, (s) => s.room);
  const [error, setError] = useState("");
  const device = result ? devices[result.deviceId] : undefined,
    profile = catalog.find((p) => p.id === device?.catalogId);
  const apply = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid value");
    }
  };
  const seat = result?.seats.find((s) => s.id === selectedSeat);
  return (
    <section className="optical-analysis">
      <h3>{mode === "camera" ? "Camera coverage" : "Display viewing"}</h3>
      <label>
        Analyze device
        <select
          aria-label="Analyze device"
          value={device?.id ?? ""}
          onChange={(e) => store.api.getState().selectDevice(e.target.value)}
        >
          <option value="" disabled>
            Select equipment
          </option>
          {Object.values(devices)
            .filter(
              (d) => d?.kind === (mode === "camera" ? "ptz_camera" : "display"),
            )
            .map(
              (d) =>
                d && (
                  <option key={d.id} value={d.id}>
                    {d.metadata.label}
                  </option>
                ),
            )}
        </select>
      </label>
      <label>
        Seated eye height (m)
        <input
          key={eyeHeight(room)}
          aria-label="Seated eye height"
          type="number"
          min="0.5"
          max={room.height}
          step="0.05"
          defaultValue={eyeHeight(room)}
          onBlur={(e) =>
            apply(() =>
              store.api
                .getState()
                .setRoom({ eyeHeightM: Number(e.target.value) }),
            )
          }
        />
      </label>
      {!device || !result ? (
        <p>Add a {mode} to analyze seats.</p>
      ) : (
        <>
          <p>
            {device.metadata.label} · {device.surface} mount
          </p>
          {mode === "camera" && (
            <p>
              HFOV {specificationText(result.hfov)}° · VFOV{" "}
              {specificationText(result.vfov)}°
            </p>
          )}
          {profile && (
            <details>
              <summary>Optical metadata · {profile.provenance}</summary>
              {Object.entries(opticalMetadata(profile)).map(([k, v]) => (
                <p key={k}>
                  {k}: {specificationText(v)}
                </p>
              ))}
              <p>{profile.source}</p>
            </details>
          )}
          <div className="optical-fields">
            {(["x", "y", "z"] as const).map((axis, i) => (
              <label key={axis}>
                {["Pitch", "Yaw", "Roll"][i]} (°)
                <input
                  key={`${device.id}-${device.rotation[axis]}`}
                  type="number"
                  step="1"
                  min="-360"
                  max="360"
                  defaultValue={
                    Math.round(
                      ((device.rotation[axis] * 180) / Math.PI) * 100,
                    ) / 100
                  }
                  onBlur={(e) =>
                    apply(() => {
                      const value = Number(e.target.value);
                      if (
                        !e.target.value ||
                        !Number.isFinite(value) ||
                        Math.abs(value) > 360
                      )
                        throw new Error("Rotation must be within ±360°");
                      store.update(device.id, {
                        rotation: { [axis]: (value * Math.PI) / 180 },
                      });
                    })
                  }
                />
              </label>
            ))}
          </div>
          {mode === "camera" &&
            profile?.provenance === "user_defined" &&
            (["horizontalFovDeg", "verticalFovDeg"] as const).map((k) => (
              <label key={k}>
                {k} (custom device override)
                <input
                  key={`${device.id}-${device.metadata[k]}`}
                  type="number"
                  min="0.01"
                  max="179.99"
                  step="any"
                  defaultValue={device.metadata[k] ?? ""}
                  placeholder="Unknown"
                  onBlur={(e) =>
                    apply(() =>
                      store.update(device.id, {
                        metadata: {
                          [k]:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      }),
                    )
                  }
                />
              </label>
            ))}
          <p>
            <strong>
              {
                result.seats.filter(
                  (s) => s.status === "inside" || s.status === "warning",
                ).length
              }{" "}
              / {result.seats.length}
            </strong>{" "}
            seats within{" "}
            {mode === "camera" ? "full geometric FOV" : "planning limits"}
          </p>
          <p className="muted fine-print">
            Green inside · red outside · gray unknown · amber within 10% of
            viewing limit. No occlusion check.
          </p>
          <div className="seat-results">
            {result.seats.map((s) => (
              <button
                key={s.id}
                aria-pressed={s.id === selectedSeat}
                onClick={() => selectSeat(s.id)}
              >
                {s.id} — {s.status}
              </button>
            ))}
          </div>
          {seat && (
            <div role="status">
              <strong>{seat.id}</strong>
              <p>
                {seat.distance.toFixed(2)} m · H {seat.horizontal.toFixed(1)}° ·
                V {seat.vertical.toFixed(1)}°
              </p>
              <p>
                Horizontal: {specificationText(seat.horizontalInside)} ·
                Vertical: {specificationText(seat.verticalInside)}
              </p>
              <p>
                {seat.reasons.join("; ") ||
                  "Within configured geometric limits."}
              </p>
            </div>
          )}
          <details>
            <summary>Method & limitations</summary>
            {result.assumptions.map((a) => (
              <p key={a}>{a}</p>
            ))}
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
