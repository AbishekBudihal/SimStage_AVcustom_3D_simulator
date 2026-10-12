import { useState } from "react";
import type { DeviceStore, PlacedDevice } from "../workspace/DeviceStore";
import { SPEC_FIELDS, specStatus, type SpecBasis, type SpecField } from "../workspace/SpecificationEvidence";
export function SpecificationInspector({ store, device }: { store: DeviceStore; device: PlacedDevice }) {
  const [field, setField] = useState<SpecField>("sensitivityDb"), [basis, setBasis] = useState<SpecBasis>("user_entered"),
    [source, setSource] = useState(""), [conditions, setConditions] = useState(""), [date, setDate] = useState(""), [error, setError] = useState("");
  const current = specStatus(device, field);
  return <details className="my-3 text-xs" aria-label="Specification evidence">
    <summary>Specification evidence & accuracy</summary>
    <p>Value changes invalidate previous evidence automatically. Recording a source is a user declaration, not independent verification.</p>
    <select aria-label="Evidence specification" value={field} onChange={e => setField(e.target.value as SpecField)}>
      {SPEC_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
    </select>
    <p>Current: {current.value ?? "Unknown"} · {current.basis}</p>
    {current.evidence && <p>{current.evidence.source} · {current.evidence.checkedOn} · {current.evidence.conditions}</p>}
    <label>Evidence basis<select aria-label="Evidence basis" value={basis} onChange={e => setBasis(e.target.value as SpecBasis)}>
      <option value="user_entered">User entered</option><option value="manufacturer">Manufacturer datasheet (user declaration)</option>
      <option value="user_measured">User-reported measurement</option><option value="derived">Derived calculation</option><option value="estimated">Estimate</option>
    </select></label>
    <label>Source / document reference<input aria-label="Evidence source" value={source} onChange={e => setSource(e.target.value)} /></label>
    <label>Checked on<input type="date" aria-label="Evidence date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label>Test conditions / derivation<input aria-label="Evidence conditions" value={conditions} onChange={e => setConditions(e.target.value)} /></label>
    <button disabled={current.value === null} onClick={() => {
      try {
        store.api.getState().updateDevice(device.id, { metadata: { specificationEvidence: {
          ...device.metadata.specificationEvidence, [field]: { value: current.value!, basis, source, checkedOn: date, conditions },
        } } }); setError("");
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }}>Record evidence for current value</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
