import { DeviceStore, type XYZ } from "./DeviceStore";
import { deviceFromProfile } from "./catalog";
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Expected a schematic object");
  return v as Record<string, unknown>;
};
const text = (v: unknown) => {
  if (typeof v !== "string" || !v.trim())
    throw new Error("Missing schematic identifier");
  return v;
};
const xyz = (v: unknown): XYZ => {
  const p = object(v);
  if (
    ![p.x, p.y, p.z].every((n) => typeof n === "number" && Number.isFinite(n))
  )
    throw new Error("Invalid schematic coordinates");
  return { x: p.x as number, y: p.y as number, z: p.z as number };
};
/** Validate in an isolated transaction, then publish only data to the authoritative store.
 * Schema: {nodes:[{id,catalogId,position?,rotation?}],connections:[{from:{deviceId,portId},to:{deviceId,portId}}]}.
 * Absent coordinates mean semantic auto placement. Explicit coordinates are manual.
 */
export function importSchematic(store: DeviceStore, input: unknown): number {
  const payload = object(input);
  if (
    !Array.isArray(payload.nodes) ||
    !Array.isArray(payload.connections) ||
    payload.nodes.length > 500 ||
    payload.connections.length > 2000
  )
    throw new Error(
      "Expected nodes and connections arrays (maximum 500 / 2000)",
    );
  const previous = store.api.getState(),
    transaction = new DeviceStore();
  transaction.api.setState({
    room: previous.room,
    roomPreset: previous.roomPreset,
    catalog: previous.catalog,
    devices: previous.devices,
    connections: previous.connections,
    nodePositions: previous.nodePositions,
  });
  const ids = new Map<string, string>();
  for (const item of payload.nodes) {
    const node = object(item),
      id = text(node.id),
      catalogId = text(node.catalogId);
    if (ids.has(id)) throw new Error(`Duplicate schematic node ${id}`);
    const profile = previous.catalog.find((p) => p.id === catalogId);
    if (!profile)
      throw new Error(
        `Unknown catalog product ${catalogId}; import its catalog definition first`,
      );
    const device = deviceFromProfile(profile, 0, previous.room);
    const placed = transaction.add({
      ...device,
      ...(node.position !== undefined
        ? {
            position: xyz(node.position),
            placement: { ...device.placement!, mode: "manual" as const },
          }
        : {}),
      ...(node.rotation !== undefined
        ? {
            rotation: xyz(node.rotation),
            placement: { ...device.placement!, mode: "manual" as const },
          }
        : {}),
    });
    ids.set(id, placed);
  }
  for (const item of payload.connections) {
    const wire = object(item);
    const endpoint = (value: unknown) => {
      const p = object(value),
        id = ids.get(text(p.deviceId));
      if (!id) throw new Error("Wire references an absent node");
      return { deviceId: id, portId: text(p.portId) };
    };
    transaction.api.getState().connect(endpoint(wire.from), endpoint(wire.to));
  }
  const next = transaction.api.getState();
  store.api.setState({
    devices: next.devices,
    connections: next.connections,
    nodePositions: next.nodePositions,
  });
  return ids.size;
}
