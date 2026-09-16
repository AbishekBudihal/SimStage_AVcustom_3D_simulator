import { useStore } from "zustand";
import type {
  DeviceStore,
  EngineeringSettings,
} from "../workspace/DeviceStore";
import type { Audit } from "../workspace/Engineering";
export function EngineeringPanel({
  store,
  audit,
}: {
  store: DeviceStore;
  audit: Audit;
}) {
  const settings = useStore(store.api, (s) => s.engineering);
  function input(
    key: keyof EngineeringSettings,
    label: string,
    min: number,
    max: number,
    step: number,
  ) {
    return (
      <label className="engineering-input" key={key}>
        <span>{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={settings[key] ?? ""}
          placeholder="Unknown"
          onChange={(e) => {
            const value = e.target.value === "" ? null : Number(e.target.value);
            if (value === null && (key === "rt60" || key === "noiseDb"))
              store.api.getState().setEngineering({ [key]: null });
            else if (
              value !== null &&
              Number.isFinite(value) &&
              value >= min &&
              value <= max
            )
              store.api.getState().setEngineering({ [key]: value });
          }}
        />
      </label>
    );
  }
  return (
    <section aria-label="Engineering audit">
      <div className="audit-score">
        <strong>
          {audit.score}
          <small>/100</small>
        </strong>
        <div>
          Planning readiness<span>5 equally weighted checks</span>
        </div>
      </div>
      <p className="muted fine-print">
        Visual, acoustic, power, thermal and wiring readiness. Unknown inputs
        count as not ready. Not a certification score.
      </p>
      <div className="audit-metrics">
        <span>{audit.seats} seats</span>
        <span>
          {audit.splMin === null
            ? "SPL unknown"
            : `${audit.splMin.toFixed(1)}–${audit.splMax!.toFixed(1)} dB`}
        </span>
      </div>
      <details className="engineering-settings">
        <summary>Criteria & acoustic assumptions</summary>
        <label className="engineering-input">
          <span>4/6/8 heuristic</span>
          <select
            value={settings.viewingRatio}
            onChange={(e) =>
              store.api
                .getState()
                .setEngineering({
                  viewingRatio: Number(e.target.value) as 4 | 6 | 8,
                })
            }
          >
            {[4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n} × image height
              </option>
            ))}
          </select>
        </label>
        {input("elementPercent", "BDM element height (%)", 0.5, 100, 0.5)}
        {input("horizontalLimit", "Horizontal limit (°)", 1, 89, 1)}
        {input("verticalLimit", "Vertical limit (°)", 1, 89, 1)}
        {input("noiseDb", "Background noise (dB)", 0, 150, 1)}
        {input("rt60", "Broadband RT60 (s)", 0.1, 20, 0.1)}
        {input("targetSpl", "SPL target (dB)", 0, 150, 1)}
        {input("powerBudget", "Power budget (W)", 1, 100000, 100)}
        {input("heatBudget", "Heat budget (BTU/h)", 1, 100000, 100)}
        <button
          onClick={() => {
            store.api.getState().setEngineering({ noiseDb: 40, rt60: 0.6 });
            for (const device of store.snapshot())
              if (device.kind === "speaker")
                store.update(device.id, { metadata: { splAt1m: 78 } });
          }}
        >
          Use illustrative acoustic inputs
        </button>
        <p className="muted fine-print">
          Preset: 78 dB at 1 m, 40 dB noise, RT60 0.6 s. Replace with measured
          values. SPL assumes omnidirectional free-field sources; maps exclude
          reflections and obstacles.
        </p>
      </details>
      <ul className="audit-warnings">
        {audit.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <details className="engineering-settings">
        <summary>Seat-by-seat visual results</summary>
        <div className="seat-results">
          {audit.visual.map((s) => (
            <div key={s.id}>
              <strong>{s.id}</strong>
              <span>
                {!s.results.length
                  ? "No display"
                  : s.results.some((r) => r.pass)
                    ? "Within planning limits"
                    : "Review"}
              </span>
              {s.results.map((r) => (
                <small key={r.deviceId}>
                  {store.get(r.deviceId)?.metadata.label}:{" "}
                  {r.distance.toFixed(1)} m · H {r.horizontal.toFixed(0)}° / V{" "}
                  {r.vertical.toFixed(0)}° · BDM max {r.bdmMax.toFixed(1)} m
                </small>
              ))}
            </div>
          ))}
        </div>
      </details>
      <p className="muted fine-print">
        DISCAS-inspired BDM distance uses the public 200 acuity factor. Full
        DISCAS compliance is unverified. The intelligibility map is a broadband
        MTF proxy, not IEC STI.
      </p>
    </section>
  );
}
