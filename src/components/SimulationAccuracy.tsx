import type { PlacedDevice } from "../workspace/DeviceStore";
import { simulationAccuracy, type SimulationLayer } from "../workspace/SpecificationEvidence";
export function SimulationAccuracy({ devices, layer }: { devices: readonly PlacedDevice[]; layer: SimulationLayer }) {
  const status = simulationAccuracy(devices, layer);
  return <details className="my-2 rounded border border-solid border-slate-600 p-2 text-xs" aria-label={`${layer} input accuracy`}>
    <summary>{status.label} · {status.supported}/{status.total} inputs have matching source evidence</summary>
    <p>{status.limitation}</p>
    <p>Manufacturer specs describe declared test conditions. User measurements are self-reported. Neither certifies the simulated room.</p>
    {!!status.missing.length && <p>Missing: {status.missing.join(" · ")}</p>}
    {!!status.unverified.length && <p>Estimated / unverified: {status.unverified.join(" · ")}</p>}
  </details>;
}
