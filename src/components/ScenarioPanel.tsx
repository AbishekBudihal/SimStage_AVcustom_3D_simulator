import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import type {
  ScenarioConfig,
  ScenarioReport,
} from "../workspace/ScenarioSimulation";

export function ScenarioPanel({ store }: { store: DeviceStore }) {
  const environment = useStore(store.api, (s) => s.environment);
  const config = useStore(store.api, (s) => s.scenario),
    room = useStore(store.api, (s) => s.room),
    devices = useStore(store.api, (s) => s.devices),
    connections = useStore(store.api, (s) => s.connections),
    engineering = useStore(store.api, (s) => s.engineering);
  const [enabled, setEnabled] = useState(false),
    [result, setResult] = useState<{
      config: typeof config;
      room: typeof room;
      devices: typeof devices;
      connections: typeof connections;
      engineering: typeof engineering;
      environment: typeof environment;
      report: ScenarioReport;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError("");
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("../workspace/scenario.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (
          e: MessageEvent<{ report?: ScenarioReport; error?: string }>,
        ) => {
          if (cancelled) return;
          if (e.data.report)
            setResult({
              environment,
              config,
              room,
              devices,
              connections,
              engineering,
              report: e.data.report,
            });
          setError(e.data.error ?? "");
          worker?.terminate();
        };
        worker.onerror = () => {
          if (cancelled) return;
          setError("Scenario worker failed. Try running again.");
          worker?.terminate();
        };
        worker.postMessage({
          state: { room, devices, connections, engineering, environment },
          config,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [enabled, config, room, devices, connections, engineering, environment]);
  const report =
    result?.config === config &&
    result.room === room &&
    result.devices === devices &&
    result.connections === connections &&
    result.environment === environment &&
    result.engineering === engineering
      ? result.report
      : null;
  const update = (key: keyof ScenarioConfig, n: number | null) => {
    try {
      store.api.getState().setScenario({ [key]: n });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section
      aria-label="Scenario stress tests"
      className="mt-4 rounded-lg border border-solid border-slate-700 p-3"
    >
      <h3>Scenario stress tests</h3>
      <p className="text-xs text-slate-400">
        Seeded Monte Carlo · microphone speech proxy + shared-link Dante
        traffic. Results test your policy, not certified deployment readiness.
      </p>
      <details>
        <summary>Scenario ranges & acceptance policy</summary>
        {(
          [
            ["iterations", "Trials", 10, 5000, 1],
            ["seed", "Random seed", 0, 4294967295, 1],
            ["occupancyMin", "Minimum occupied seats (%)", 1, 100, 1],
            ["occupancyMax", "Maximum occupied seats (%)", 1, 100, 1],
            ["noiseMin", "Minimum background noise (dB)", 0, 120, 1],
            ["noiseMax", "Maximum background noise (dB)", 0, 120, 1],
            ["occupiedNoiseRise", "Full occupancy noise rise (dB)", 0, 30, 1],
            ["rt60Min", "Minimum RT60 (s)", 0.05, 20, 0.05],
            ["rt60Max", "Maximum RT60 (s)", 0.05, 20, 0.05],
            ["speechDb", "Speech level at 1 m (dB)", 30, 100, 1],
            ["proxyThreshold", "Minimum speech proxy", 0.01, 1, 0.01],
            ["extraFlowsMin", "Minimum extra Dante flows", 0, 10000, 1],
            ["extraFlowsMax", "Maximum extra Dante flows", 0, 10000, 1],
            ["linkMbps", "Shared link capacity (Mb/s)", 1, 100000, 1],
            ["otherTrafficMbps", "Other link traffic (Mb/s)", 0, 100000, 1],
            ["utilizationLimit", "Maximum link utilization", 0.01, 1, 0.01],
            ["requiredPassPercent", "Required passing trials (%)", 1, 100, 1],
          ] as [keyof ScenarioConfig, string, number, number, number][]
        ).map(([key, label, min, max, step]) => (
          <label key={key} className="my-2 block text-xs">
            {label}
            <input
              aria-label={label}
              type="number"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-1 text-white"
              min={min}
              max={max}
              step={step}
              value={config[key] ?? ""}
              placeholder="Unknown"
              onChange={(e) => {
                const n = e.currentTarget.valueAsNumber;
                if (
                  e.target.value === "" &&
                  ["rt60Min", "rt60Max", "linkMbps"].includes(key)
                )
                  update(key, null);
                else if (Number.isFinite(n)) update(key, n);
              }}
            />
          </label>
        ))}
        <p className="text-xs">
          Uniform independent ranges; occupancy randomly selects existing seats.
          Noise rises by the configured energy interpolation. No crowd
          absorption, packet scheduling, QoS or redundancy simulation.
        </p>
      </details>
      <button
        className="my-2"
        onClick={() => {
          setError("");
          setEnabled((v) => !v);
        }}
      >
        {enabled ? "Pause live tests" : "Run live stress tests"}
      </button>
      {error && <p role="alert">{error}</p>}
      <div role="status">
        {enabled && !report && !error ? (
          "Recalculating…"
        ) : !report ? (
          "Not run for current inputs"
        ) : (
          <>
            <strong
              className={
                report.status === "pass"
                  ? "text-emerald-300"
                  : report.status === "fail"
                    ? "text-red-300"
                    : "text-amber-300"
              }
            >
              {report.status.toUpperCase()} · scenario policy
            </strong>
            {report.audit.missingRequired.length > 0 && (
              <p className="text-amber-300">
                Wiring blocker: {report.audit.missingRequired.length} required
                ports are unconnected.
              </p>
            )}
            <p>
              {report.passPercent.toFixed(1)}% modeled joint pass rate ·{" "}
              {report.iterations} trials · seed {report.seed}
              {!enabled ? " · paused" : ""}
            </p>
            <p>
              Acoustic {report.acousticPassPercent.toFixed(1)}% · Network{" "}
              {report.networkPassPercent.toFixed(1)}% · {report.unknownTrials}{" "}
              unverified trials
            </p>
            <p>
              P95 traffic {report.p95Mbps.toFixed(1)} Mb/s · minimum speech
              proxy {report.minProxy?.toFixed(2) ?? "Unknown"}
            </p>
            <details>
              <summary>Worst sampled scenario & wiring findings</summary>
              <p>
                {report.worst.occupants} occupants ·{" "}
                {report.worst.noiseDb.toFixed(1)} dB noise ·{" "}
                {report.worst.rt60?.toFixed(2) ?? "Unknown"} s RT60 ·{" "}
                {report.worst.extraFlows} extra flows ·{" "}
                {report.worst.mbps.toFixed(1)} Mb/s
              </p>
              <ul>
                {report.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {report.audit.missingRequired.map((r) => (
                  <li key={r}>Missing required connection: {r}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Speech proxy is broadband MTF, not IEC STI. PASS only means the sampled
        model meets the configured thresholds. Field commissioning remains
        unverified.
      </p>
    </section>
  );
}
