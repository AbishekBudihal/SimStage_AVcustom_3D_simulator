import { useState } from "react";
import { useStore } from "zustand";
import type { DeviceStore } from "../workspace/DeviceStore";
export function CatalogLibrary({
  store,
  ready,
  spawn,
}: {
  store: DeviceStore;
  ready: boolean;
  spawn: (id: string) => void;
}) {
  const catalog = useStore(store.api, (s) => s.catalog);
  const [query, setQuery] = useState(""),
    [placeholders, setPlaceholders] = useState(false),
    [category, setCategory] = useState("All"),
    [message, setMessage] = useState("");
  const products = catalog.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      (placeholders || p.provenance !== "user_defined") &&
      `${p.manufacturer} ${p.model} ${p.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <h1>Simulator catalog</h1>
      <p className="muted">
        {catalog.length} source records. Imported estimates retain their
        original provenance; missing specifications stay unknown.
      </p>
      <label className="engineering-input">
        <span>AV category</span>
        <select
          aria-label="AV category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All</option>
          {[...new Set(catalog.map((p) => p.category))].sort().map((c) => (
            <option key={c} value={c}>
              {c === "matrix" || c === "switcher"
                ? "Switchers / Matrices"
                : c === "extender"
                  ? "Extenders / Converters"
                  : c === "dsp"
                    ? "DSP"
                    : c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="engineering-input">
        <span>Search hardware</span>
        <input
          aria-label="Search hardware"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label className="muted fine-print">
        <input
          type="checkbox"
          checked={placeholders}
          onChange={(e) => setPlaceholders(e.target.checked)}
        />{" "}
        Include user-defined placeholders
      </label>
      <label className="engineering-input">
        <span>Import catalog JSON</span>
        <input
          aria-label="Import catalog JSON"
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              if (file.size > 5_000_000)
                throw new Error("Maximum file size is 5 MB");
              const data: unknown = JSON.parse(await file.text());
              store.api.getState().importCatalog(data, file.name);
              setMessage(`Imported ${file.name}`);
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Import failed",
              );
            }
          }}
        />
      </label>
      {message && (
        <p role="status" className="muted fine-print">
          {message}
        </p>
      )}
      <div className="inventory-list">
        {products.map((item) => (
          <button
            key={item.id}
            draggable={ready}
            disabled={!ready}
            className="inventory-button"
            onClick={() => spawn(item.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/simstage-device", item.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <span>
              <strong>
                {item.manufacturer} {item.model}
              </strong>
              <small>
                {item.category} · {item.provenance}
              </small>
              <small>
                {item.ports.length
                  ? `${item.ports.length} declared ports`
                  : "Ports unspecified"}
              </small>
            </span>
            <span aria-hidden="true">+</span>
          </button>
        ))}
      </div>
      {!products.length && (
        <p className="muted">No matching catalog records.</p>
      )}
    </>
  );
}
