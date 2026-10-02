import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import {
  calibration,
  freezeEnvironment,
  parseDxf,
  validateOutline,
  type ImportedEnvironment,
  type PlanPoint,
  type PlanOutline,
} from "../workspace/EnvironmentImport";
export function EnvironmentImporter({ store }: { store: DeviceStore }) {
  const current = useStore(store.api, (s) => s.environment),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ImportedEnvironment | null>(null),
    [error, setError] = useState(""),
    [notes, setNotes] = useState<string[]>([]),
    [points, setPoints] = useState<PlanPoint[]>([]),
    [mode, setMode] = useState<"calibrate" | "trace">("calibrate"),
    [known, setKnown] = useState(1),
    [calibrated, setCalibrated] = useState(false),
    [kind, setKind] = useState<PlanOutline["kind"]>("wall"),
    [height, setHeight] = useState(3),
    [elevation, setElevation] = useState(0),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    serial = useRef(0);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(
    () => () => {
      serial.current++;
    },
    [],
  );
  function attempt(fn: () => void) {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function read(file: File) {
    const ticket = ++serial.current;
    setBusy(true);
    setError("");
    try {
      if (file.size > 10_000_000)
        throw Error("Choose a file smaller than 10 MB.");
      let plan: ImportedEnvironment,
        warnings: string[] = [];
      if (/\.dwg$/i.test(file.name))
        throw Error(
          "Native DWG decoding is not available. Export model-space closed polylines as ASCII DXF in your CAD application, then import that DXF.",
        );
      if (/\.dxf$/i.test(file.name)) {
        const result = parseDxf(await file.text());
        plan = { ...result.plan, name: file.name };
        warnings = result.warnings;
      } else if (/\.(png|jpe?g)$/i.test(file.name)) {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(Error("Unable to read image."));
          r.readAsDataURL(file);
        });
        const bitmap = await createImageBitmap(file);
        const width = bitmap.width,
          height = bitmap.height;
        bitmap.close();
        if (width * height > 24_000_000 || width > 8192 || height > 8192)
          throw Error("Image maximum is 8192 px per side and 24 megapixels.");
        plan = {
          name: file.name,
          image: data,
          width,
          height,
          metersPerUnit: 1,
          outlines: [],
        };
        warnings = [
          "Trace closed wall footprints, ceiling outlines or audience blocks. Pixels are not automatically classified as architecture.",
        ];
      } else throw Error("Choose PNG, JPG or ASCII DXF.");
      if (ticket !== serial.current) return;
      setDraft(plan);
      setNotes(warnings);
      setPoints([]);
      setMode("calibrate");
      setCalibrated(false);
    } catch (e) {
      if (ticket === serial.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  }
  const close = () => {
    serial.current++;
    setBusy(false);
    setOpen(false);
  };
  return (
    <section
      className="panel-note environment-entry"
      aria-label="Environment import"
    >
      <h3>Floor plan & environment</h3>
      <p>
        {current
          ? `${current.name} · ${current.outlines.length} meshes`
          : "Calibrate a drawing and build editable 3D outlines."}
      </p>
      <button
        onClick={() => {
          setDraft(current ? structuredClone(current) : null);
          setCalibrated(!!current);
          setPoints([]);
          setError("");
          setNotes([]);
          setOpen(true);
        }}
      >
        Import / edit floor plan
      </button>
      {current && (
        <button onClick={() => store.api.getState().setEnvironment(null)}>
          Remove imported environment
        </button>
      )}
      <dialog
        ref={dialog}
        className="environment-dialog"
        aria-label="Environment importer"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header>
          <h2>Calibrate & build environment</h2>
          <button aria-label="Close environment importer" onClick={close}>
            Close
          </button>
        </header>
        <label>
          Floor plan file{" "}
          <input
            aria-label="Floor plan file"
            type="file"
            accept=".png,.jpg,.jpeg,.dxf,.dwg"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
              e.target.value = "";
            }}
          />
        </label>
        <p>
          PNG/JPG: trace footprints. ASCII DXF: closed straight LWPOLYLINE
          footprints. DWG requires DXF export. All processing stays in this
          browser.
        </p>
        {busy && <p role="status">Reading plan…</p>}
        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
        {draft && (
          <>
            <h3>{draft.name}</h3>
            <div className="environment-grid">
              <div>
                <div className="flex gap-2">
                  <button
                    aria-pressed={mode === "calibrate"}
                    onClick={() => {
                      setMode("calibrate");
                      setPoints([]);
                    }}
                  >
                    1. Calibrate distance
                  </button>
                  <button
                    disabled={!calibrated}
                    aria-pressed={mode === "trace"}
                    onClick={() => {
                      setMode("trace");
                      setPoints([]);
                    }}
                  >
                    2. Trace footprint
                  </button>
                  <button
                    disabled={!points.length}
                    onClick={() => setPoints((p) => p.slice(0, -1))}
                  >
                    Undo point
                  </button>
                </div>
                <p>
                  {mode === "calibrate"
                    ? "Click two points at the ends of a known distance."
                    : "Click vertices around a closed footprint, then Add mesh. Wall footprints should include wall thickness."}
                </p>
                <svg
                  className="environment-preview"
                  viewBox={`0 0 ${draft.width} ${draft.height}`}
                  role="img"
                  aria-label="Floor plan calibration and outline editor"
                  onClick={(e) => {
                    const matrix = e.currentTarget.getScreenCTM();
                    if (!matrix) return;
                    let p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                      matrix.inverse(),
                    );
                    if (
                      p.x < 0 ||
                      p.y < 0 ||
                      p.x > draft.width ||
                      p.y > draft.height
                    )
                      return;
                    // Snap vector calibration to nearby actual vertices, avoiding pixel rounding.
                    if (!draft.image) {
                      const radius = 10 / Math.hypot(matrix.a, matrix.b);
                      let nearest = radius;
                      for (const o of draft.outlines)
                        for (const v of o.points) {
                          const distance = Math.hypot(v.x - p.x, v.y - p.y);
                          if (distance < nearest) {
                            nearest = distance;
                            p = new DOMPoint(v.x, v.y);
                          }
                        }
                    }
                    setPoints((old) =>
                      mode === "calibrate"
                        ? old.length === 2
                          ? [{ x: p.x, y: p.y }]
                          : [...old, { x: p.x, y: p.y }]
                        : [...old, { x: p.x, y: p.y }],
                    );
                  }}
                >
                  {draft.image && (
                    <image
                      href={draft.image}
                      width={draft.width}
                      height={draft.height}
                    />
                  )}
                  {draft.outlines.map((o) => (
                    <polygon
                      key={o.id}
                      points={o.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={
                        o.kind === "wall"
                          ? "#94a3b866"
                          : o.kind === "audience"
                            ? "#38bdf866"
                            : "#fbbf2466"
                      }
                      stroke="#38bdf8"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <polyline
                    points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                  />
                  {points.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={Math.max(draft.width, draft.height) / 180}
                      fill="#ef4444"
                    />
                  ))}
                </svg>
              </div>
              <div>
                {mode === "calibrate" ? (
                  <>
                    <label>
                      Known distance (m)
                      <input
                        aria-label="Known distance (m)"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={known}
                        onChange={(e) => setKnown(e.target.valueAsNumber)}
                      />
                    </label>
                    <button
                      disabled={points.length !== 2}
                      onClick={() =>
                        attempt(() => {
                          const scale = calibration(
                            points[0],
                            points[1],
                            known,
                          );
                          if (Math.max(draft.width, draft.height) * scale > 500)
                            throw Error("Scaled plan exceeds 500 m.");
                          setDraft({ ...draft, metersPerUnit: scale });
                          setCalibrated(true);
                          setPoints([]);
                          setMode("trace");
                        })
                      }
                    >
                      Apply calibration
                    </button>
                  </>
                ) : (
                  <>
                    <label>
                      Surface type
                      <select
                        aria-label="Outline surface type"
                        value={kind}
                        onChange={(e) =>
                          setKind(e.target.value as PlanOutline["kind"])
                        }
                      >
                        <option value="wall">Wall footprint</option>
                        <option value="ceiling">Ceiling slab</option>
                        <option value="audience">Audience block</option>
                      </select>
                    </label>
                    <label>
                      Base elevation (m)
                      <input
                        aria-label="Outline elevation"
                        type="number"
                        min="0"
                        step="0.1"
                        value={elevation}
                        onChange={(e) => setElevation(e.target.valueAsNumber)}
                      />
                    </label>
                    <label>
                      Extrusion height (m)
                      <input
                        aria-label="Outline height"
                        type="number"
                        min="0.01"
                        max="30"
                        step="0.01"
                        value={height}
                        onChange={(e) => setHeight(e.target.valueAsNumber)}
                      />
                    </label>
                    <button
                      disabled={points.length < 3}
                      onClick={() =>
                        attempt(() => {
                          const outline = {
                            id: crypto.randomUUID(),
                            points,
                            kind,
                            elevation,
                            height,
                          };
                          validateOutline(outline);
                          setDraft({
                            ...draft,
                            outlines: [...draft.outlines, outline],
                          });
                          setPoints([]);
                        })
                      }
                    >
                      Add mesh
                    </button>
                  </>
                )}
                <p>
                  {calibrated
                    ? `${(draft.width * draft.metersPerUnit).toFixed(2)} × ${(draft.height * draft.metersPerUnit).toFixed(2)} m · ${draft.metersPerUnit.toPrecision(4)} m/unit`
                    : "Calibration required"}
                </p>
                <div className="environment-outlines">
                  {draft.outlines.map((o, i) => (
                    <div key={o.id}>
                      <span>Outline {i + 1}</span>
                      <select
                        aria-label={`Outline ${i + 1} type`}
                        value={o.kind}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            outlines: draft.outlines.map((p) =>
                              p.id === o.id
                                ? {
                                    ...p,
                                    kind: e.target.value as PlanOutline["kind"],
                                  }
                                : p,
                            ),
                          })
                        }
                      >
                        {["wall", "ceiling", "audience"].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                      <label>
                        Base m
                        <input
                          aria-label={`Outline ${i + 1} elevation`}
                          type="number"
                          min="0"
                          step="0.1"
                          value={o.elevation}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              outlines: draft.outlines.map((p) =>
                                p.id === o.id
                                  ? { ...p, elevation: e.target.valueAsNumber }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Height m
                        <input
                          aria-label={`Outline ${i + 1} height`}
                          type="number"
                          min="0.01"
                          step="0.1"
                          value={o.height}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              outlines: draft.outlines.map((p) =>
                                p.id === o.id
                                  ? { ...p, height: e.target.valueAsNumber }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        aria-label={`Delete outline ${i + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            outlines: draft.outlines.filter(
                              (p) => p.id !== o.id,
                            ),
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p>
              Imported geometry is centred on the room and keeps its calibrated
              dimensions when room dimensions change. Equipment, connections and
              BOM remain in the active store. Imported surfaces are not
              automatically assigned seats or equipment mounting anchors.
            </p>
            <footer>
              <button
                disabled={!calibrated || busy}
                onClick={() =>
                  attempt(() => {
                    store.api
                      .getState()
                      .setEnvironment(freezeEnvironment(draft));
                    close();
                  })
                }
              >
                Apply to workspace
              </button>
              <button
                disabled={!calibrated || busy}
                onClick={() =>
                  attempt(() => {
                    const plan = freezeEnvironment(draft),
                      width = plan.width * plan.metersPerUnit,
                      depth = plan.height * plan.metersPerUnit;
                    if (width < 3 || depth < 3 || width > 30 || depth > 30)
                      throw Error(
                        "Room fit supports 3–30 m per side. Apply as overlay for other sizes.",
                      );
                    store.api.getState().setRoom({ width, depth });
                    store.api.getState().setEnvironment(plan);
                    close();
                  })
                }
              >
                Fit room & apply
              </button>
            </footer>
          </>
        )}
      </dialog>
    </section>
  );
}
