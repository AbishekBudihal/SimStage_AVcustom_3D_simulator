import { CustomProduct } from "./CustomProduct";
import {
  CATEGORIES,
  catalogCategory,
  filterCatalog,
  opticalMetadata,
  specificationText,
  type CatalogCategory,
} from "../workspace/CatalogQuery";
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
    [manufacturer, setManufacturer] = useState("All"),
    [category, setCategory] = useState<CatalogCategory | "All">("camera"),
    [message, setMessage] = useState("");
  const products = filterCatalog(catalog, { query, category, manufacturer });
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
          onChange={(e) =>
            setCategory(e.target.value as CatalogCategory | "All")
          }
        >
          <option>All</option>
          {Object.entries(CATEGORIES).map(([id, label]) => (
            <option key={id} value={id}>
              {label} ({catalog.filter((p) => catalogCategory(p) === id).length}
              )
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
      <label className="engineering-input">
        <span>Manufacturer</span>
        <select
          aria-label="Manufacturer"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
        >
          <option>All</option>
          {[...new Set(catalog.map((p) => p.manufacturer))].sort().map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <CustomProduct
        store={store}
        onAdded={() => {
          setCategory("All");
          setManufacturer("All");
          setQuery("");
        }}
      />
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
          <article key={item.id} className="catalog-card">
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
              <span>Add to Room</span>
            </button>
            <details>
              <summary>Product details</summary>
              <p>
                {item.dimensions.x} × {item.dimensions.y} × {item.dimensions.z}{" "}
                m
              </p>
              <p>Mounting: {item.surfaces.join(", ")}</p>
              <p>
                Power {specificationText(item.metadata.powerWatts)} W · Heat{" "}
                {specificationText(item.metadata.heatBtuPerHour)} BTU/h
              </p>
              {(item.kind === "ptz_camera" || item.kind === "display") &&
                Object.entries(opticalMetadata(item)).map(([key, value]) => (
                  <div key={key}>
                    {key}: {specificationText(value)}
                  </div>
                ))}
              {item.kind === "ceiling_mic" && (
                <p>
                  Pickup: {item.metadata.micModel ?? "Unknown"} · radius{" "}
                  {specificationText(item.metadata.micRadiusM)} m · angle{" "}
                  {specificationText(item.metadata.micAngleDeg)}°
                </p>
              )}
              {item.kind === "speaker" && (
                <p>
                  Dispersion H / V:{" "}
                  {specificationText(item.metadata.horizontalDispersionDeg)}° /{" "}
                  {specificationText(item.metadata.verticalDispersionDeg)}° ·
                  conical {specificationText(item.metadata.coverageDegrees)}°.
                  Reference{" "}
                  {specificationText(
                    item.metadata.referenceSplDb ?? item.metadata.splAt1m,
                  )}{" "}
                  dB.
                </p>
              )}
              <p>
                {item.ports
                  .map((p) => `${p.label} (${p.direction}, ${p.signal})`)
                  .join(" · ") || "Ports Unknown"}
              </p>
              <p>
                {item.provenance}: {item.source}
              </p>
            </details>
          </article>
        ))}
      </div>
      {!products.length && (
        <p className="muted">No matching catalog records.</p>
      )}
    </>
  );
}
