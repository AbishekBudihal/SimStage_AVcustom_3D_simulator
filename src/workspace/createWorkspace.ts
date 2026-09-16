import { DeviceStore } from "./DeviceStore";
import { catalogDevice } from "./Catalog";
/** Illustrative layout, no invented power or thermal specifications. */
export function createWorkspace() {
  const store = new DeviceStore();
  const display = store.add(
    catalogDevice("display", 0, { x: 0, y: 1.5, z: -3 }),
  );
  const source = store.add(
    catalogDevice("source", 0, { x: 0, y: 0.75, z: 0.5 }),
  );
  const matrix = store.add(
    catalogDevice("matrix", 0, { x: -0.5, y: 0.75, z: 1 }),
  );
  const mic = store.add(catalogDevice("ceiling_mic", 0, { x: 0, y: 3, z: 0 }));
  store.add(catalogDevice("ptz_camera", 0, { x: 0, y: 0.75, z: -1 }));
  const speaker = store.add(catalogDevice("speaker", 0, { x: 2, y: 2, z: -3 }));
  const dsp = store.add(catalogDevice("dsp", 0, { x: 0.5, y: 0.75, z: 1 }));
  store.add(catalogDevice("rack", 0, { x: 3, y: 0, z: -2 }));
  store.api
    .getState()
    .connect(
      { deviceId: source, portId: "HDMI out" },
      { deviceId: matrix, portId: "HDMI in 1" },
    );
  store.api
    .getState()
    .connect(
      { deviceId: matrix, portId: "HDMI out 1" },
      { deviceId: display, portId: "HDMI in" },
    );
  store.api
    .getState()
    .connect(
      { deviceId: mic, portId: "Dante out" },
      { deviceId: dsp, portId: "Dante in 1" },
    );
  store.api
    .getState()
    .connect(
      { deviceId: dsp, portId: "Dante out 1" },
      { deviceId: speaker, portId: "Dante in" },
    );
  return store;
}
