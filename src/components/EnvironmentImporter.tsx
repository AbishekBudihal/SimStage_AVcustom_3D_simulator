import { BlueprintPreview } from "./BlueprintPreview";
import { BlueprintInspector } from "./BlueprintInspector";
import { snapPlanPoint, wallFootprint } from "../workspace/BlueprintTopology";
import {
  serializeBlueprint,
  parseBlueprint,
  pdfBlueprint,
  exportBlueprint,
  downloadBlob,
} from "../workspace/BlueprintIO";
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
    [mode, setMode] = useState<
      "calibrate" | "trace" | "wall" | "inspect" | "pan"
    >("calibrate"),
    [known, setKnown] = useState(1),
    [calibrated, setCalibrated] = useState(false),
    [kind, setKind] = useState<PlanOutline["kind"]>("wall"),
    [height, setHeight] = useState(3),
    [elevation, setElevation] = useState(0),
    [busy, setBusy] = useState(false);
  const [pdfPage, setPdfPage] = useState(1),
    [grid, setGrid] = useState(0.1),
    [selected, setSelected] = useState<string | null>(null),
    [split, setSplit] = useState(true),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) =>
        Math.min(20, Math.max(0.25, z * Math.exp(-e.deltaY * 0.001))),
      );
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [open, !!draft]);
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
      if (file.size > (/\.json$/i.test(file.name) ? 40_000_000 : 10_000_000))
        throw Error(
          "Choose a source file below 10 MB (blueprint JSON below 40 MB).",
        );
      let plan: ImportedEnvironment,
        warnings: string[] = [];
      if (/\.dwg$/i.test(file.name))
        throw Error(
          "Native DWG decoding is not available. Export model-space closed polylines as ASCII DXF in your CAD application, then import that DXF.",
        );
      if (/\.json$/i.test(file.name)) {
        plan = parseBlueprint(await file.text());
      } else if (/\.pdf$/i.test(file.name)) {
        plan = await pdfBlueprint(file, pdfPage);
        warnings = [
          "PDF page rendered locally. Calibrate and trace; embedded CAD semantics are not inferred.",
        ];
      } else if (/\.dxf$/i.test(file.name)) {
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
      } else throw Error("Choose PNG, JPG, PDF, ASCII DXF or blueprint JSON.");
      if (ticket !== serial.current) return;
      setDraft(plan);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setSelected(null);
      setNotes(warnings);
      setPoints([]);
      setMode("calibrate");
      setCalibrated(/\.json$/i.test(file.name));
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
        <details open={!draft}>
          <summary>Import source / new blueprint</summary>
          <button
            onClick={() => {
              const room = store.api.getState().room;
              setDraft({
                name: "New blueprint",
                width: room.width * 100,
                height: room.depth * 100,
                metersPerUnit: 0.01,
                outlines: [],
              });
              setCalibrated(true);
              setMode("wall");
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setPoints([]);
              setSelected(null);
              setError("");
            }}
          >
            New blank blueprint
          </button>
          <label>
            Floor plan file{" "}
            <input
              aria-label="Floor plan file"
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,.dxf,.dwg,.json"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void read(f);
                e.target.value = "";
              }}
            />
          </label>
          <label>
            PDF page to import
            <input
              aria-label="PDF page to import"
              type="number"
              min="1"
              value={pdfPage}
              onChange={(e) => setPdfPage(e.target.valueAsNumber)}
            />
          </label>
          <p>
            PNG/JPG/PDF: manual tracing. ASCII DXF: closed straight LWPOLYLINE
            footprints. DWG requires DXF export. All processing stays in this
            browser.
          </p>
        </details>
        {busy && <p role="status">Processing…</p>}
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
            <div className="blueprint-actions">
              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                Fit blueprint
              </button>
              <button onClick={() => setZoom((z) => Math.min(20, z * 1.25))}>
                Zoom in
              </button>
              <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
                Zoom out
              </button>
              <button aria-pressed={split} onClick={() => setSplit((v) => !v)}>
                2D / 3D split
              </button>
              <label>
                Snap grid (m)
                <select
                  aria-label="Snap grid metres"
                  value={grid}
                  onChange={(e) => setGrid(Number(e.target.value))}
                >
                  <option value="0">Off</option>
                  <option value="0.05">0.05</option>
                  <option value="0.1">0.1</option>
                  <option value="0.5">0.5</option>
                </select>
              </label>
              <button
                disabled={!calibrated}
                onClick={() =>
                  attempt(() =>
                    downloadBlob(
                      new Blob([serializeBlueprint(draft)], {
                        type: "application/json",
                      }),
                      "blueprint.simstage.json",
                    ),
                  )
                }
              >
                Save blueprint JSON
              </button>
              {(["glb", "obj"] as const).map((format) => (
                <button
                  key={format}
                  disabled={!calibrated || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      downloadBlob(
                        await exportBlueprint(draft, format),
                        `environment.${format}`,
                      );
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Export {format.toUpperCase()}
                </button>
              ))}
            </div>
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
                <div className="blueprint-actions">
                  {(["wall", "inspect", "pan"] as const).map((tool) => (
                    <button
                      key={tool}
                      disabled={!calibrated && tool !== "pan"}
                      aria-pressed={mode === tool}
                      onClick={() => {
                        setMode(tool);
                        setPoints([]);
                      }}
                    >
                      {tool === "wall"
                        ? "Wall centerline"
                        : tool === "inspect"
                          ? "Select / edit"
                          : "Pan blueprint"}
                    </button>
                  ))}
                </div>
                <p>
                  {mode === "calibrate"
                    ? "Click two points at the ends of a known distance."
                    : mode === "wall"
                      ? "Click two endpoints per wall. Default thickness 0.2 m; edit openings in the inspector."
                      : mode === "pan"
                        ? "Drag to pan; use zoom controls to inspect details."
                        : mode === "inspect"
                          ? "Select a footprint or 3D mesh to edit dimensions, vertices and openings."
                          : "Click vertices around a closed footprint, then Add mesh."}
                </p>
                <div
                  className={
                    split && calibrated
                      ? "blueprint-views split"
                      : "blueprint-views"
                  }
                >
                  <svg
                    className="environment-preview"
                    viewBox={`${pan.x} ${pan.y} ${draft.width / zoom} ${draft.height / zoom}`}
                    ref={svgRef}
                    onPointerDown={(e) => {
                      if (mode !== "pan") return;
                      const m = e.currentTarget.getScreenCTM();
                      if (!m) return;
                      const p = new DOMPoint(
                        e.clientX,
                        e.clientY,
                      ).matrixTransform(m.inverse());
                      drag.current = {
                        x: p.x,
                        y: p.y,
                        panX: pan.x,
                        panY: pan.y,
                      };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!drag.current) return;
                      const m = e.currentTarget.getScreenCTM();
                      if (!m) return;
                      const p = new DOMPoint(
                        e.clientX,
                        e.clientY,
                      ).matrixTransform(m.inverse());
                      setPan((old) => ({
                        x: old.x + drag.current!.x - p.x,
                        y: old.y + drag.current!.y - p.y,
                      }));
                    }}
                    onPointerUp={(e) => {
                      drag.current = null;
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                    }}
                    role="img"
                    aria-label="Floor plan calibration and outline editor"
                    onClick={(e) => {
                      if (mode === "pan" || mode === "inspect") return;
                      const matrix = e.currentTarget.getScreenCTM();
                      if (!matrix) return;
                      let p = new DOMPoint(
                        e.clientX,
                        e.clientY,
                      ).matrixTransform(matrix.inverse());
                      if (
                        p.x < 0 ||
                        p.y < 0 ||
                        p.x > draft.width ||
                        p.y > draft.height
                      )
                        return;
                      const snapped = snapPlanPoint(
                        { x: p.x, y: p.y },
                        draft,
                        mode === "calibrate" ? 0 : grid,
                        10 / Math.hypot(matrix.a, matrix.b),
                      );
                      p = new DOMPoint(snapped.x, snapped.y);
                      if (mode === "wall" && points.length === 1) {
                        attempt(() => {
                          const segment = {
                            start: points[0],
                            end: { x: p.x, y: p.y },
                            thickness: 0.2,
                            openings: [],
                          };
                          const outline: PlanOutline = {
                            id: crypto.randomUUID(),
                            kind: "wall",
                            points: wallFootprint(segment, draft.metersPerUnit),
                            segment,
                            height: 3,
                            elevation: 0,
                            material: "plaster",
                          };
                          setDraft(
                            freezeEnvironment({
                              ...draft,
                              outlines: [...draft.outlines, outline],
                            }),
                          );
                          setPoints([]);
                          setSelected(outline.id);
                        });
                        return;
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
                        onClick={(e) => {
                          if (mode === "inspect") {
                            e.stopPropagation();
                            setSelected(o.id);
                          }
                        }}
                        points={o.points.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill={
                          o.kind === "wall"
                            ? "#94a3b866"
                            : o.kind === "audience"
                              ? "#38bdf866"
                              : "#fbbf2466"
                        }
                        stroke={selected === o.id ? "#f97316" : "#38bdf8"}
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
                  {split && calibrated && (
                    <BlueprintPreview
                      plan={draft}
                      selected={selected}
                      onSelect={(id) => {
                        setSelected(id);
                        setMode("inspect");
                      }}
                    />
                  )}
                </div>
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
                          setDraft(
                            freezeEnvironment({
                              ...draft,
                              metersPerUnit: scale,
                            }),
                          );
                          setCalibrated(true);
                          setPoints([]);
                          setMode("trace");
                        })
                      }
                    >
                      Apply calibration
                    </button>
                  </>
                ) : mode === "trace" ? (
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
                        <option value="floor">Floor slab</option>
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
                ) : null}
                <p>
                  {calibrated
                    ? `${(draft.width * draft.metersPerUnit).toFixed(2)} × ${(draft.height * draft.metersPerUnit).toFixed(2)} m · ${draft.metersPerUnit.toPrecision(4)} m/unit`
                    : "Calibration required"}
                </p>
                {calibrated && (
                  <BlueprintInspector
                    plan={draft}
                    selected={selected}
                    onSelect={setSelected}
                    onChange={setDraft}
                    onError={setError}
                  />
                )}
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
