import type {
  ImportedEnvironment,
  PlanOutline,
} from "../workspace/EnvironmentImport";
import { freezeEnvironment } from "../workspace/EnvironmentImport";
import {
  wallFootprint,
  roomSurfaces,
  layoutGraph,
  wallLength,
} from "../workspace/BlueprintTopology";
export function BlueprintInspector({
  plan,
  selected,
  onSelect,
  onChange,
  onError,
}: {
  plan: ImportedEnvironment;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (p: ImportedEnvironment) => void;
  onError: (s: string) => void;
}) {
  const item = plan.outlines.find((o) => o.id === selected),
    graph = layoutGraph(plan);
  function attempt(fn: () => void) {
    try {
      fn();
      onError("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }
  function update(patch: Partial<PlanOutline>) {
    if (!item) return;
    attempt(() => {
      const next = { ...item, ...patch };
      if (next.segment)
        next.points = wallFootprint(next.segment, plan.metersPerUnit);
      onChange(
        freezeEnvironment({
          ...plan,
          zoneCeilingHeight: item.id.startsWith("zone-")
            ? undefined
            : plan.zoneCeilingHeight,
          outlines: plan.outlines.map((o) => (o.id === item.id ? next : o)),
        }),
      );
    });
  }
  const number = (
    label: string,
    value: number,
    change: (n: number) => void,
  ) => (
    <label key={label}>
      {label}
      <input
        aria-label={label}
        type="number"
        step="0.1"
        defaultValue={value}
        key={`${selected}:${label}:${value}`}
        onBlur={(e) => {
          if (e.target.valueAsNumber !== value) change(e.target.valueAsNumber);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
  return (
    <section className="blueprint-inspector">
      <h3>Geometry inspector</h3>
      <p>
        {graph.nodes.length} junctions · {graph.edges.length} wall edges ·{" "}
        {graph.rooms.length} bounded zones
      </p>
      <button
        disabled={!graph.rooms.length}
        onClick={() =>
          attempt(() => {
            const surfaces = roomSurfaces(plan, 3);
            onChange(
              freezeEnvironment({
                ...plan,
                zoneCeilingHeight: 3,
                outlines: [
                  ...plan.outlines.filter((o) => !o.id.startsWith("zone-")),
                  ...surfaces,
                ],
              }),
            );
          })
        }
      >
        Generate zone floors & ceilings
      </button>
      <p>
        Slabs inset to wall inner edges. Nested loops/holes need manual review.
      </p>
      <select
        aria-label="Selected architectural object"
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">Select a 2D/3D object</option>
        {plan.outlines.map((o, i) => (
          <option key={o.id} value={o.id}>
            {i + 1}. {o.kind}
            {o.segment ? " (wall line)" : ""}
          </option>
        ))}
      </select>
      {item && (
        <>
          {!item.segment && (
            <label>
              Surface type
              <select
                aria-label="Architectural surface type"
                value={item.kind}
                onChange={(e) =>
                  update({ kind: e.target.value as PlanOutline["kind"] })
                }
              >
                {["wall", "floor", "ceiling", "audience"].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Material
            <select
              aria-label="Architectural material"
              value={item.material ?? "plaster"}
              onChange={(e) =>
                update({ material: e.target.value as PlanOutline["material"] })
              }
            >
              {["plaster", "concrete", "wood"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {number("Object height (m)", item.height, (n) =>
            update({ height: n }),
          )}
          {number("Object base elevation (m)", item.elevation, (n) =>
            update({ elevation: n }),
          )}
          {item.segment ? (
            <>
              {number("Wall thickness (m)", item.segment.thickness, (n) =>
                update({ segment: { ...item.segment!, thickness: n } }),
              )}
              {(["start", "end"] as const).flatMap((end) =>
                (["x", "y"] as const).map((axis) =>
                  number(
                    `${end} ${axis} (plan units)`,
                    item.segment![end][axis],
                    (n) =>
                      update({
                        segment: {
                          ...item.segment!,
                          [end]: { ...item.segment![end], [axis]: n },
                        },
                      }),
                  ),
                ),
              )}
              <p>
                Wall length:{" "}
                {wallLength(item.segment, plan.metersPerUnit).toFixed(2)} m
              </p>
              {(["door", "window"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() =>
                    update({
                      segment: {
                        ...item.segment!,
                        openings: [
                          ...item.segment!.openings,
                          {
                            id: crypto.randomUUID(),
                            kind,
                            offset: 0.2,
                            width: 0.9,
                            bottom: kind === "door" ? 0 : 1,
                            height: kind === "door" ? 2.1 : 1.2,
                          },
                        ],
                      },
                    })
                  }
                >
                  Add {kind} opening
                </button>
              ))}
              {item.segment.openings.map((opening) => (
                <fieldset key={opening.id}>
                  <legend>{opening.kind} opening</legend>
                  {(["offset", "width", "bottom", "height"] as const).map(
                    (key) =>
                      number(
                        `Opening ${opening.id.slice(0, 4)} ${key} (m)`,
                        opening[key],
                        (n) =>
                          update({
                            segment: {
                              ...item.segment!,
                              openings: item.segment!.openings.map((p) =>
                                p.id === opening.id ? { ...p, [key]: n } : p,
                              ),
                            },
                          }),
                      ),
                  )}
                  <button
                    onClick={() =>
                      update({
                        segment: {
                          ...item.segment!,
                          openings: item.segment!.openings.filter(
                            (p) => p.id !== opening.id,
                          ),
                        },
                      })
                    }
                  >
                    Remove opening
                  </button>
                </fieldset>
              ))}
            </>
          ) : (
            <details>
              <summary>Edit footprint vertices</summary>
              {item.points.map((p, i) => (
                <div key={i}>
                  {(["x", "y"] as const).map((axis) =>
                    number(`Vertex ${i + 1} ${axis}`, p[axis], (n) =>
                      update({
                        points: item.points.map((v, j) =>
                          j === i ? { ...v, [axis]: n } : v,
                        ),
                      }),
                    ),
                  )}
                </div>
              ))}
            </details>
          )}
          <button
            onClick={() =>
              attempt(() => {
                onChange(
                  freezeEnvironment({
                    ...plan,
                    zoneCeilingHeight: item.id.startsWith("zone-")
                      ? undefined
                      : plan.zoneCeilingHeight,
                    outlines: plan.outlines.filter((o) => o.id !== item.id),
                  }),
                );
                onSelect(null);
              })
            }
          >
            Delete selected object
          </button>
        </>
      )}
    </section>
  );
}
