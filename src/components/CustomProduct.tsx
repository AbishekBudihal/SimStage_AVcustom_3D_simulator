import { useState } from "react";
import type { DeviceStore } from "../workspace/DeviceStore";
import { CATEGORIES, type CatalogCategory } from "../workspace/CatalogQuery";
export function CustomProduct({
  store,
  onAdded,
}: {
  store: DeviceStore;
  onAdded: (id: string) => void;
}) {
  const [error, setError] = useState("");
  return (
    <details className="engineering-settings">
      <summary>Add Custom Product</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const f = new FormData(e.currentTarget),
              text = (k: string) => String(f.get(k) ?? "").trim(),
              n = (k: string) => (text(k) === "" ? undefined : Number(text(k)));
            const category = text("category"),
              id = `custom-${crypto.randomUUID()}`;
            const raw = {
              id,
              manufacturer: text("manufacturer") || "User-defined",
              model: text("model"),
              category,
              physical: {
                width: n("width"),
                height: n("height"),
                depth: n("depth"),
              },
              mounting: { [text("mount")]: true },
              provenance: "user_defined",
              source:
                "Engineer-entered specifications; not manufacturer verified",
              camera: {
                horizontalFovDeg: n("hfov"),
                verticalFovDeg: n("vfov"),
                diagonalFovDeg: n("dfov"),
              },
              display: {
                diagonalInches: n("diagonal"),
                aspectRatio: text("aspect") || undefined,
                resolution: text("resolution") || undefined,
              },
              microphone: {
                coverageModel: text("pickupModel") || undefined,
                pickupRadiusM: n("pickupRadius"),
                pickupAngleDeg: n("pickupAngle"),
              },
              speaker: {
                horizontalDispersionDeg: n("hDispersion"),
                verticalDispersionDeg: n("vDispersion"),
                referenceSplDb: n("referenceSpl"),
                referenceDistanceM: n("referenceDistance"),
              },
              ports: JSON.parse(text("ports") || "[]"),
            };
            store.api.getState().importCatalog([raw], "Custom product form");
            setError("Product added to catalog");
            onAdded(id);
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Invalid product",
            );
          }
        }}
      >
        <label>
          Category
          <select name="category">
            {Object.entries(CATEGORIES).map(([id, label]) => (
              <option value={id as CatalogCategory} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Manufacturer
          <input name="manufacturer" placeholder="User-defined" />
        </label>
        <label>
          Model
          <input name="model" required />
        </label>
        <p className="fine-print muted">
          Dimensions define the physical envelope. Optional blank specifications
          remain Unknown.
        </p>
        {["width", "height", "depth"].map((k) => (
          <label key={k}>
            {k} (m)
            <input
              required
              name={k}
              type="number"
              min="0.001"
              max="100"
              step="any"
            />
          </label>
        ))}
        <label>
          Mount
          <select name="mount">
            {["wall", "ceiling", "table", "floor"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {["hfov", "vfov", "dfov"].map((k) => (
          <label key={k}>
            {k.toUpperCase()} (camera degrees)
            <input name={k} type="number" min="0.01" max="179.99" step="any" />
          </label>
        ))}
        <label>
          Display diagonal (inches)
          <input name="diagonal" type="number" min="0.01" step="any" />
        </label>
        <label>
          Aspect ratio
          <input name="aspect" placeholder="e.g. 16:9" />
        </label>
        <label>
          Resolution
          <input name="resolution" placeholder="e.g. 3840x2160" />
        </label>
        <label>
          Ports (optional JSON)
          <textarea
            name="ports"
            placeholder={
              '[{"id":"hdmi-in","label":"HDMI","direction":"input","connector":"HDMI","transport":"hdmi"}]'
            }
          />
        </label>
        <details>
          <summary>Optional audio specifications</summary>
          <label>
            Pickup model
            <select name="pickupModel">
              <option value="">Unknown</option>
              <option value="omni">Omnidirectional</option>
              <option value="cone">3D cone</option>
              <option value="horizontal_sector">Horizontal sector</option>
              <option value="radius_only">Preferred radius only</option>
            </select>
          </label>
          {[
            ["pickupRadius", "Pickup radius (m)"],
            ["pickupAngle", "Pickup angle (°)"],
            ["hDispersion", "H dispersion (°)"],
            ["vDispersion", "V dispersion (°)"],
            ["referenceSpl", "Source reference SPL (dB)"],
            ["referenceDistance", "Source reference distance (m)"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input name={key} type="number" step="any" />
            </label>
          ))}
        </details>
        <button type="submit">Save custom product</button>
        <p role="status">{error}</p>
      </form>
    </details>
  );
}
