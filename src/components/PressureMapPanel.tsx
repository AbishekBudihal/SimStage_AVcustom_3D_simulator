import { useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import {
  parseBandText,
  type PressureSettings,
  type PressureResult,
} from "../workspace/PressureModel";
export function PressureMapPanel({
  store,
  result,
  error,
}: {
  store: DeviceStore;
  result: PressureResult | null;
  error: string;
}) {
  const state = useStore(store.api),
    s = state.pressure,
    [formError, setFormError] = useState("");
  const speakers = Object.values(state.devices).filter(
    (d) => d?.kind === "speaker",
  );
  const speaker =
    speakers.find((d) => d?.id === state.selectedId) ?? speakers[0];
  const apply = (fn: () => void) => {
    try {
      fn();
      setFormError("");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };
  const field = (
    key: keyof PressureSettings,
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label key={key} className="my-2 block text-xs">
      {label}
      <input
        className="mt-1 w-full rounded bg-slate-800 p-1 text-white"
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(s[key])}
        onChange={(e) => {
          const value = e.target.valueAsNumber;
          if (Number.isFinite(value))
            apply(() => state.setPressure({ [key]: value }));
        }}
      />
    </label>
  );
  return (
    <section
      aria-label="Pressure map controls"
      className="mt-3 rounded-lg border border-solid border-sky-800 p-3"
    >
      <h3>Speaker pressure map</h3>
      <p className="text-xs text-slate-400">
        User-entered parametric estimate · 1/12-octave calculation bands, not
        lab-measured polar data.
      </p>
      <label className="block">
        Test signal
        <select
          aria-label="Pressure test signal"
          value={s.signal}
          onChange={(e) =>
            state.setPressure({
              signal: e.target.value as PressureSettings["signal"],
            })
          }
        >
          <option value="pink">Pink noise</option>
          <option value="speech">Speech-shaped noise (generic)</option>
          <option value="sine">Sine tone (phase-locked)</option>
        </select>
      </label>
      <label className="block">
        Map surface
        <select
          aria-label="Pressure map surface"
          value={s.surface}
          onChange={(e) =>
            state.setPressure({
              surface: e.target.value as PressureSettings["surface"],
            })
          }
        >
          <option value="audience">Audience plane</option>
          <option value="surfaces">Floor and tabletops</option>
        </select>
      </label>
      <details>
        <summary>Signal, surface & room assumptions</summary>
        {s.signal === "sine" ? (
          field("toneHz", "Tone frequency (Hz)", 20, 20000, 1)
        ) : (
          <>
            {field("lowHz", "Lower band limit (Hz)", 20, 19999, 1)}
            {field("highHz", "Upper band limit (Hz)", 21, 20000, 1)}
          </>
        )}
        {s.surface === "audience" && (
          <>
            {field("audienceHeight", "Audience front height (m)", 0, 8, 0.05)}
            {field("audienceRise", "Audience rear rise (m)", 0, 6, 0.05)}
          </>
        )}
        {field("spacing", "Sample spacing (m)", 0.1, 1, 0.05)}
        <label className="block">
          <input
            type="checkbox"
            checked={s.obstruction}
            onChange={(e) =>
              state.setPressure({ obstruction: e.target.checked })
            }
          />
          Table/rack obstruction
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={s.reflections}
            onChange={(e) =>
              state.setPressure({ reflections: e.target.checked })
            }
          />
          First room reflections
        </label>
        {s.reflections &&
          field("absorption", "Boundary absorption (0–1, assumed)", 0, 1, 0.05)}
        {field("minimumDb", "Map minimum (dB SPL)", 0, 149, 1)}
        {field("maximumDb", "Map maximum (dB SPL)", 1, 150, 1)}
      </details>
      <details open>
        <summary>Enter speaker details</summary>
        {!speaker ? (
          <p>Add a speaker from the catalog first.</p>
        ) : (
          <>
            <select
              aria-label="Pressure map speaker"
              value={speaker.id}
              onChange={(e) => state.selectDevice(e.target.value)}
            >
              {speakers.map(
                (d) =>
                  d && (
                    <option key={d.id} value={d.id}>
                      {d.metadata.label}
                    </option>
                  ),
              )}
            </select>
            <form
              key={`${speaker.id}:${JSON.stringify(speaker.metadata)}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                apply(() =>
                  store.update(speaker.id, {
                    metadata: {
                      sensitivityDb: Number(f.get("sensitivity")),
                      speakerWatts: Number(f.get("power")),
                      horizontalDispersionDeg: Number(f.get("horizontal")),
                      verticalDispersionDeg: Number(f.get("vertical")),
                      acousticPhaseDeg: Number(f.get("phase")),
                      acousticDelayMs: Number(f.get("delay")),
                      acousticBands: parseBandText(
                        String(f.get("bands") ?? ""),
                      ),
                    },
                  }),
                );
              }}
            >
              {(
                [
                  [
                    "sensitivity",
                    "Sensitivity (dB SPL, 1 W / 1 m)",
                    speaker.metadata.sensitivityDb,
                    0,
                    150,
                  ],
                  [
                    "power",
                    "Drive power (W)",
                    speaker.metadata.speakerWatts,
                    0,
                    speaker.metadata.maxSpeakerWatts ?? 100000,
                  ],
                  [
                    "horizontal",
                    "Horizontal dispersion (degrees, −6 dB)",
                    speaker.metadata.horizontalDispersionDeg ??
                      speaker.metadata.coverageDegrees,
                    1,
                    360,
                  ],
                  [
                    "vertical",
                    "Vertical dispersion (degrees, −6 dB)",
                    speaker.metadata.verticalDispersionDeg ??
                      speaker.metadata.coverageDegrees,
                    1,
                    360,
                  ],
                  [
                    "phase",
                    "Sine source phase (degrees)",
                    speaker.metadata.acousticPhaseDeg ?? 0,
                    -360,
                    360,
                  ],
                  [
                    "delay",
                    "Source delay (ms)",
                    speaker.metadata.acousticDelayMs ?? 0,
                    0,
                    1000,
                  ],
                ] as const
              ).map(([name, label, value, min, max]) => (
                <label key={name} className="my-2 block text-xs">
                  {label}
                  <input
                    aria-label={label}
                    className="mt-1 w-full rounded bg-slate-800 p-1 text-white"
                    type="number"
                    name={name}
                    defaultValue={value ?? ""}
                    min={min}
                    max={max}
                    step="any"
                    required
                    placeholder="Required"
                  />
                </label>
              ))}
              <details>
                <summary>Frequency-dependent response (optional)</summary>
                <p className="text-xs">
                  One row per frequency: Hz, sensitivity dB, horizontal degrees,
                  vertical degrees. Ascending frequencies must span the test
                  band. Blank uses the values above at all frequencies.
                </p>
                <textarea
                  aria-label="Speaker frequency response rows"
                  className="w-full bg-slate-800 text-white"
                  name="bands"
                  rows={4}
                  placeholder={
                    "125, 88, 180, 180\n1000, 92, 100, 80\n8000, 86, 60, 45"
                  }
                  defaultValue={
                    speaker.metadata.acousticBands
                      ?.map((b) =>
                        [
                          b.hz,
                          b.sensitivityDb,
                          b.horizontalDeg,
                          b.verticalDeg,
                        ].join(", "),
                      )
                      .join("\n") ?? ""
                  }
                />
              </details>
              <button type="submit">Apply speaker data</button>
              <p className="text-xs text-slate-400">
                Overrides this placed speaker; manufacturer catalog records stay
                unchanged. Drive power is total test-signal electrical power.
              </p>
            </form>
          </>
        )}
      </details>
      {(error || formError) && <p role="alert">{error || formError}</p>}
      <div role="status">
        {result ? (
          <>
            <strong>
              {result.minimum?.toFixed(1) ?? "Unknown"}–
              {result.maximum?.toFixed(1) ?? "Unknown"} dB SPL
            </strong>
            <p>
              {result.sampleCount} samples · {result.frequencyCount} calculation
              bands · {result.unknown} unknown · {result.blocked} fully
              obstructed
            </p>
            <details>
              <summary>Data and model notes</summary>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          </>
        ) : error ? (
          "Map unavailable"
        ) : (
          "Calculating pressure surfaces…"
        )}
      </div>
      <p className="text-xs text-slate-400">
        Free-field spreading beyond 1 m; rigid table/rack shadows; optional
        single reflections in a closed rectangular shell. No diffraction, late
        reverberation, air absorption, crowd scattering, measured phase or room
        modes. Not STI. Below-scale/silent samples are dark blue; grey is
        unknown. Smooth shading interpolates computed samples.
      </p>
    </section>
  );
}
