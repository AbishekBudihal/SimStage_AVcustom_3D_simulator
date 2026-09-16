import { useMemo, useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
import { summarizeBom } from "../workspace/BomSummary";
export function BOMDrawer({ store }: { store: DeviceStore }) {
  const [open, setOpen] = useState(false);
  const devices = useStore(store.api, (state) => state.devices);
  const bom = useMemo(() => summarizeBom(devices), [devices]);
  const health = !bom.count
    ? "No devices"
    : bom.incomplete
      ? `${bom.incomplete} devices need specifications`
      : "Power and heat metadata complete";
  return (
    <section
      className="shrink-0 border-0 border-t border-solid border-slate-700 bg-[#15181e] text-slate-200"
      aria-label="Bill of materials"
    >
      <button
        className="flex w-full flex-wrap items-center justify-between gap-3 border-0 bg-transparent px-6 py-4 text-left text-slate-200 hover:bg-slate-800"
        aria-expanded={open}
        aria-controls="bom-content"
        onClick={() => setOpen(!open)}
      >
        <strong className="text-xs">
          Bill of materials{" "}
          <span className="ml-2 text-slate-400">{bom.count} devices</span>
        </strong>
        <span className="text-xs text-slate-400">
          Planning load: {bom.power.toLocaleString()} W ·{" "}
          {bom.heat.toLocaleString()} BTU/h{" "}
          <span className="ml-4">{open ? "Collapse −" : "Expand +"}</span>
        </span>
      </button>
      {open && (
        <div id="bom-content" className="max-h-64 overflow-auto px-6 pb-4">
          <p
            className={`text-xs ${bom.incomplete ? "text-amber-300" : "text-slate-300"}`}
            role="status"
          >
            {health}. Mixed typical, maximum and upper-bound ratings; calculated
            heat is not measured HVAC load. PoE export may be double-counted;
            passive speaker drive excludes amplifier mains consumption. See
            hardware sources in the inspector.
          </p>
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                {[
                  "Equipment / catalog",
                  "Qty",
                  "Known power",
                  "Known heat",
                ].map((label) => (
                  <th
                    key={label}
                    className="border-0 border-b border-solid border-slate-700 py-3 pr-4 font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bom.rows.map((row) => (
                <tr key={JSON.stringify([row.catalogId, row.kind])}>
                  <td className="py-3 pr-4">
                    {row.kind.split("_").join(" ")}
                    <span className="ml-3 text-slate-500">{row.catalogId}</span>
                  </td>
                  <td>{row.quantity}</td>
                  <td>
                    {row.power.toLocaleString()} W{" "}
                    {row.unknownPower > 0 && (
                      <span className="text-amber-300">
                        ({row.unknownPower} unknown)
                      </span>
                    )}
                  </td>
                  <td>
                    {row.heat.toLocaleString()} BTU/h{" "}
                    {row.unknownHeat > 0 && (
                      <span className="text-amber-300">
                        ({row.unknownHeat} unknown)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!bom.count && (
            <p className="text-xs text-slate-500">
              Add equipment from Quick inventory to build your BOM.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
