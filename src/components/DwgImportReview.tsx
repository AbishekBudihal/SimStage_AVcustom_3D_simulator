import { roomSurfaces } from "../workspace/BlueprintTopology";
import { freezeEnvironment } from "../workspace/EnvironmentImport";
import { useState } from "react";
import { cadUnits, extrudeCad, type CadDrawing } from "../workspace/DwgImport";
import type { ImportedEnvironment } from "../workspace/EnvironmentImport";
export function DwgImportReview({
  drawing,
  onBuild,
  onCancel,
  onApply,
}: {
  drawing: CadDrawing;
  onBuild: (plan: ImportedEnvironment) => void;
  onCancel: () => void;
  onApply?: (plan: ImportedEnvironment) => void;
}) {
  const [floors, setFloors] = useState(true);
  const layers = [...new Set(drawing.paths.map((p) => p.layer))].sort();
  const [selected, setSelected] = useState<string[]>([]),
    [scale, setScale] = useState(drawing.metersPerUnit ?? 0),
    [height, setHeight] = useState(3),
    [thickness, setThickness] = useState(0.2),
    [mode, setMode] = useState<"walls" | "footprints">("walls"),
    [error, setError] = useState("");
  const build = () => {
    const plan = extrudeCad(drawing, selected, scale, height, thickness, mode);
    const slabs = floors ? roomSurfaces(plan, Math.max(2, height)).filter(o => o.kind === "floor") : [];
    return freezeEnvironment({ ...plan, outlines: [...plan.outlines, ...slabs] });
  };
  const all = drawing.paths.flatMap((p) => p.points),
    minX = Math.min(...all.map((p) => p.x)),
    minY = Math.min(...all.map((p) => p.y)),
    width = Math.max(1, Math.max(...all.map((p) => p.x)) - minX),
    depth = Math.max(1, Math.max(...all.map((p) => p.y)) - minY),
    pad = Math.max(width, depth) * 0.03;
  return (
    <section className="dwg-review" aria-label="CAD extrusion setup">
      <h3>CAD layers → editable 3D architecture</h3>
      <p>
        {drawing.name} · {drawing.paths.length} supported paths. Select only
        architectural layers; selected paths are blue.
      </p>
      <div className="blueprint-actions">
      {onApply && <button disabled={!scale || !selected.length} onClick={() => {
        try { onApply(build()); }
        catch(e) { setError(e instanceof Error ? e.message : String(e)); }
      }}>Extrude & show in workspace</button>}
      <button
        disabled={!scale || !selected.length}
        onClick={() => {
          try {
            onBuild(
              build(),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Preview / edit extrusion
      </button>
      <button onClick={onCancel}>Cancel CAD setup</button>
      </div>
      <p role="status">{!selected.length ? "Select architectural layers below to enable extrusion." : !scale ? "Confirm drawing units below to enable extrusion." : `${selected.length} layers ready for extrusion.`}</p>
      <p>1. Select wall layers · 2. Confirm units and height · 3. Extrude · 4. Show model in workspace.</p>
      <svg
        role="img"
        aria-label="Decoded CAD layer preview"
        viewBox={`${minX - pad} ${minY - pad} ${width + pad * 2} ${depth + pad * 2}`}
        style={{ width: "100%", height: 180, background: "#edf2f7" }}
      >
        {drawing.paths.map((p) => (
          <polyline
            key={p.id}
            points={[...p.points, ...(p.closed ? [p.points[0]] : [])]
              .map((v) => v.x + "," + v.y)
              .join(" ")}
            fill="none"
            stroke={selected.includes(p.layer) ? "#2563eb" : "#a0a8b0"}
            strokeWidth={selected.includes(p.layer) ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="blueprint-actions">
        <button onClick={() => setSelected(layers)}>Select all layers</button>
        <button onClick={() => setSelected([])}>Clear layers</button>
      </div>
      <div style={{ maxHeight: 160, overflowY: "auto" }}>
        {layers.map((layer) => (
          <label key={layer} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={selected.includes(layer)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, layer]
                    : selected.filter((l) => l !== layer),
                )
              }
            />
            {layer} ({drawing.paths.filter((p) => p.layer === layer).length}{" "}
            paths)
          </label>
        ))}
      </div>
      <div className="blueprint-actions">
        <label>
          Drawing units
          <select
            aria-label="CAD drawing units"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            <option value={0}>Confirm units…</option>
            {cadUnits.map((u) => (
              <option value={u.scale} key={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interpret selected linework
          <select
            aria-label="CAD extrusion mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="walls">Wall centerlines / room boundaries</option>
            <option value="footprints">Solid closed wall footprints</option>
          </select>
        </label>
        <label>
          Wall height (m)
          <input
            aria-label="CAD wall height"
            type="number"
            min=".1"
            max="30"
            step=".1"
            value={height}
            onChange={(e) => setHeight(e.target.valueAsNumber)}
          />
        </label>
        <label>
          Wall thickness (m)
          <input
            aria-label="CAD wall thickness"
            type="number"
            min=".02"
            max="2"
            step=".01"
            disabled={mode === "footprints"}
            value={thickness}
            onChange={(e) => setThickness(e.target.valueAsNumber)}
          />
        </label>
      </div>
      <p>
        Centerlines thicken each line into a wall. Footprints fill closed
        polygons: use only actual wall footprints, not room perimeters.
        Doors/windows are edited after extrusion.
      </p>
      <label><input type="checkbox" aria-label="Generate floors for closed zones" checked={floors} onChange={e=>setFloors(e.target.checked)} /> Generate floors for closed room boundaries</label>
      <details>
        <summary>Import report ({drawing.warnings.length})</summary>
        {drawing.warnings.map((w, i) => (
          <p key={i}>{w}</p>
        ))}
      </details>
      {error && <p role="alert">{error}</p>}
      <p>
        <a
          href="/licenses/LibreDWG-NOTICE.txt"
          target="_blank"
          rel="noreferrer"
        >
          LibreDWG license & source
        </a>{" "}
        · Decoded locally; no drawing upload to a server.
      </p>
    </section>
  );
}
