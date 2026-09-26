import { useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore, DeviceMetadata } from "../workspace/DeviceStore";
import type { AudioAnalysis } from "../workspace/AudioEngineering";
import { eyeHeight } from "../workspace/RoomLayout";

export function AudioAnalysisPanel({
  store,
  mode,
  analysis,
  microphones,
  speakers,
  scope,
  setScope,
  layer,
  setLayer,
  selectedSeat,
  selectSeat,
}: {
  store: DeviceStore;
  mode: string;
  analysis?: AudioAnalysis;
  microphones: AudioAnalysis;
  speakers: AudioAnalysis;
  scope: "room" | "device";
  setScope: (v: "room" | "device") => void;
  layer: "coverage" | "spl";
  setLayer: (v: "coverage" | "spl") => void;
  selectedSeat: string | null;
  selectSeat: (id: string) => void;
}) {
  const state = useStore(store.api),
    [error, setError] = useState("");
  const candidates = Object.values(state.devices).filter(
    (d) => d?.kind === (mode === "microphone" ? "ceiling_mic" : "speaker"),
  );
  const device =
    candidates.find((d) => d?.id === state.selectedId) ??
    candidates.find((d) => d?.id === analysis?.devices[0]?.deviceId);
  const profile = state.catalog.find((p) => p.id === device?.catalogId);
  const apply = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid value");
    }
  };
  const summary = (a: AudioAnalysis) =>
    `${a.seats.filter((s) => s.status === "covered" || s.status === "edge").length}/${a.seats.length} seats in geometric coverage`;
  const numeric = (key: keyof DeviceMetadata, label: string) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        key={`${device?.id}:${device?.metadata[key]}`}
        type="number"
        step="any"
        defaultValue={
          typeof device?.metadata[key] === "number"
            ? Number(device.metadata[key])
            : ""
        }
        placeholder="Unknown"
        onBlur={(e) =>
          device &&
          apply(() =>
            state.updateDevice(device.id, {
              metadata: {
                [key]:
                  e.target.value === "" ? undefined : Number(e.target.value),
              },
            }),
          )
        }
      />
    </label>
  );
  return (
    <section className="optical-analysis">
      <h3>Audio planning</h3>
      <p>Microphones: {summary(microphones)}</p>
      <p>Speakers: {summary(speakers)}</p>
      <p>
        Seat SPL:{" "}
        {speakers.range
          ? `${speakers.range[0].toFixed(1)}–${speakers.range[1].toFixed(1)} dB (estimate)`
          : "Unknown / unavailable"}
      </p>
      {analysis && (
        <>
          <label>
            Analysis scope
            <select
              aria-label="Audio analysis scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as "room" | "device")}
            >
              <option value="room">All room devices</option>
              <option value="device">Selected device</option>
            </select>
          </label>
          <label>
            Audio device
            <select
              aria-label="Audio device"
              value={device?.id ?? ""}
              onChange={(e) => state.selectDevice(e.target.value)}
            >
              <option value="" disabled>
                Select equipment
              </option>
              {candidates.map(
                (d) =>
                  d && (
                    <option key={d.id} value={d.id}>
                      {d.metadata.label}
                    </option>
                  ),
              )}
            </select>
          </label>
          {mode === "speaker" && (
            <label>
              Floor layer
              <select
                aria-label="Audio floor layer"
                value={layer}
                onChange={(e) => setLayer(e.target.value as "coverage" | "spl")}
              >
                <option value="coverage">Geometric coverage</option>
                <option value="spl">Estimated direct SPL</option>
              </select>
            </label>
          )}
          <label>
            Seated listener / voice height (m)
            <input
              aria-label="Listener height"
              type="number"
              step="0.05"
              key={eyeHeight(state.room)}
              defaultValue={eyeHeight(state.room)}
              onBlur={(e) =>
                apply(() =>
                  state.setRoom({ eyeHeightM: Number(e.target.value) }),
                )
              }
            />
          </label>
          <p className="fine-print muted">
            Uses the shared seated eye-height plane for mouth and ears. Floor
            colors show samples at this height, not at floor level.
          </p>
          {device && (
            <>
              <p>
                {device.metadata.label} · {device.surface} · anchor{" "}
                {device.position.y.toFixed(2)} m
              </p>
              <details>
                <summary>
                  Source metadata · {profile?.provenance ?? "Unknown"}
                </summary>
                {Object.entries(device.metadata)
                  .filter(([k]) =>
                    /mic|dispersion|spl|sensitivity|speakerwatts|reference/i.test(
                      k,
                    ),
                  )
                  .map(([k, v]) => (
                    <p key={k}>
                      {k}: {v ?? "Unknown"}
                    </p>
                  ))}
              </details>
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis}>
                  Audio rotation {axis.toUpperCase()} (°)
                  <input
                    aria-label={`Audio rotation ${axis.toUpperCase()}`}
                    type="number"
                    step="5"
                    key={`${device.id}:${device.rotation[axis]}`}
                    defaultValue={Math.round(
                      (device.rotation[axis] * 180) / Math.PI,
                    )}
                    onBlur={(e) =>
                      apply(() =>
                        state.updateDevice(device.id, {
                          rotation: {
                            [axis]: (Number(e.target.value) * Math.PI) / 180,
                          },
                        }),
                      )
                    }
                  />
                </label>
              ))}
              {profile?.provenance === "user_defined" && (
                <details>
                  <summary>Custom audio specifications</summary>
                  {mode === "microphone" ? (
                    <>
                      <label>
                        Pickup model
                        <select
                          aria-label="Pickup model"
                          value={device.metadata.micModel ?? ""}
                          onChange={(e) =>
                            apply(() =>
                              state.updateDevice(device.id, {
                                metadata: {
                                  micModel: (e.target.value ||
                                    undefined) as DeviceMetadata["micModel"],
                                },
                              }),
                            )
                          }
                        >
                          <option value="">Unknown</option>
                          <option value="omni">Omnidirectional</option>
                          <option value="cone">3D cone</option>
                          <option value="horizontal_sector">
                            Horizontal sector
                          </option>
                          <option value="radius_only">
                            Preferred radius only
                          </option>
                        </select>
                      </label>
                      {numeric("micRadiusM", "Preferred pickup radius (m)")}
                      {numeric("micAngleDeg", "Full pickup angle (°)")}
                    </>
                  ) : (
                    <>
                      {numeric("coverageDegrees", "Conical dispersion (°)")}
                      {numeric(
                        "horizontalDispersionDeg",
                        "Horizontal dispersion (°)",
                      )}
                      {numeric(
                        "verticalDispersionDeg",
                        "Vertical dispersion (°)",
                      )}
                      {numeric("referenceSplDb", "Reference SPL (dB)")}
                      {numeric("referenceDistanceM", "Reference distance (m)")}
                      {numeric(
                        "sensitivityDb",
                        "Sensitivity (dB at 1 W / 1 m)",
                      )}
                      {numeric("speakerWatts", "Acoustic drive assumption (W)")}
                    </>
                  )}
                </details>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <p>
            {analysis.scope}: {summary(analysis)}
          </p>
          {analysis.missingSplDevices.length > 0 && (
            <p>SPL incomplete: {analysis.missingSplDevices.join(", ")}.</p>
          )}
          <div className="seat-results">
            {analysis.seats.map((s) => (
              <button
                key={s.id}
                className={s.id === selectedSeat ? "active" : ""}
                onClick={() => selectSeat(s.id)}
              >
                {s.id} · {s.status}
                {s.spl !== null ? ` · ${s.spl.toFixed(1)} dB` : ""}
              </button>
            ))}
          </div>
          {selectedSeat &&
            analysis.devices.map((d) => {
              const seat = d.seats.find((s) => s.id === selectedSeat);
              return (
                seat && (
                  <p key={d.deviceId}>
                    {state.devices[d.deviceId]?.metadata.label}: {seat.status} ·{" "}
                    {seat.distance.toFixed(2)} m · H{" "}
                    {seat.horizontal.toFixed(1)}° / V {seat.vertical.toFixed(1)}
                    °{seat.spl !== null ? ` · ${seat.spl.toFixed(1)} dB` : ""}.{" "}
                    {seat.reasons.join(". ")}
                  </p>
                )
              );
            })}
          <details>
            <summary>Calculation method & limitations</summary>
            <p>
              Green: inside; amber: outer 10% of radius or half-angle; red:
              outside; gray: Unknown. Multiple devices use coverage union: any
              covered device covers the seat. A missing model cannot prove
              coverage.
            </p>
            <p>
              Microphone radius is a preferred 3D distance. Beamforming radius
              does not simulate steering or measured polar response. Speaker
              dispersion uses the full rotated local axis, including pitch.
            </p>
            <p>
              Direct SPL uses a stated reference level and distance, or
              sensitivity plus drive power. Distance loss is 20 log₁₀(r/r₀),
              clamped below r₀. Assumed smooth polar attenuation is −6 dB at the
              nominal half-angle, capped at −30 dB. Multiple sources sum energy,
              not dB averages. Missing contributors make totals Unknown.
            </p>
            <p>
              No reflections, RT60, noise, phase or STI simulation. These
              planning estimates do not establish AVIXA compliance.{" "}
              <a
                href="https://www.avixa.org/resources/standards/audio-coverage-uniformity"
                target="_blank"
                rel="noreferrer"
              >
                AVIXA audio coverage verification
              </a>{" "}
              requires measurements.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
