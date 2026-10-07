import { simulationBlocker } from "./SimulationGeometry";
import type { DeviceState, PlacedDevice } from "./DeviceStore";
import { sampleListeningPlane } from "./ListeningGrid";
import { visualCheck, type FieldPoint } from "./Engineering";
/** Seat-height sampling, projected to the floor; unknown displays cannot establish failure. */
export function viewingField(
  state: Pick<DeviceState, "devices" | "room" | "engineering"> & Partial<Pick<DeviceState, "environment">>,
): FieldPoint[] {
  const blocked = simulationBlocker(state.environment);
  const displays = Object.values(state.devices).filter(
    (d): d is PlacedDevice => !!d && d.kind === "display",
  );
  return sampleListeningPlane(state.room).map((p) => {
    const checks = displays.map((d) => visualCheck(d, p, state.engineering, blocked));
    const value = checks.some((c) => c.status === "green")
      ? 1
      : checks.some((c) => c.status === "yellow")
        ? 0.5
        : !checks.length || checks.some((c) => c.status === "unknown")
          ? null
          : 0;
    return { x: p.x, z: p.z, spl: value, intelligibility: null };
  });
}
