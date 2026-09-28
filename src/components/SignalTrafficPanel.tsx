import { useEffect, useState } from "react";
import type { DeviceStore, DeviceState } from "../workspace/DeviceStore";
import {
  canDeclareTraffic,
  signalAudit,
  trafficMbps,
} from "../workspace/ScenarioSimulation";
export function SignalTrafficPanel({
  store,
  state,
  selected,
}: {
  store: DeviceStore;
  state: DeviceState;
  selected: string | null;
}) {
  const audit = signalAudit(state),
    dante = state.connections.filter(canDeclareTraffic),
    [choice, setChoice] = useState("");
  useEffect(() => {
    if (selected) setChoice(selected);
  }, [selected]);
  const connection = dante.find((c) => c.id === choice) ?? dante[0];
  const traffic = connection?.traffic;
  return (
    <details className="border-b border-slate-700 px-3 py-2 text-xs">
      <summary>
        Signal & traffic audit · {audit.missingRequired.length} required ports
        missing · {audit.knownMbps.toFixed(1)} Mb/s declared
      </summary>
      <p>
        {audit.unknownPorts.length} devices have unspecified ports ·{" "}
        {audit.unknownTraffic} Dante links have unknown traffic. Physical wiring
        does not prove end-to-end DSP routing or Dante compatibility. Only
        explicitly labeled Dante links or declared subscriptions enter the
        traffic budget.
      </p>
      {connection ? (
        <>
          <label>
            Network connection
            <select
              aria-label="Network connection"
              value={connection.id}
              onChange={(e) => setChoice(e.target.value)}
            >
              {dante.map((c) => (
                <option key={c.id} value={c.id}>
                  {state.devices[c.from.deviceId]?.metadata.label} →{" "}
                  {state.devices[c.to.deviceId]?.metadata.label}
                </option>
              ))}
            </select>
          </label>
          <form
            key={`${connection.id}:${JSON.stringify(traffic)}`}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              store.api
                .getState()
                .setConnectionTraffic(connection.id, {
                  channels: Number(f.get("channels")),
                  receivers: Number(f.get("receivers")),
                  sampleRate: Number(f.get("rate")) as 48000 | 96000,
                });
            }}
          >
            <label>
              Channels
              <input
                aria-label="Dante channels"
                name="channels"
                type="number"
                min="1"
                max="512"
                required
                defaultValue={traffic?.channels ?? 4}
              />
            </label>
            <label>
              Unicast receivers
              <input
                aria-label="Dante receivers"
                name="receivers"
                type="number"
                min="1"
                max="256"
                required
                defaultValue={traffic?.receivers ?? 1}
              />
            </label>
            <label>
              Sample rate
              <select name="rate" defaultValue={traffic?.sampleRate ?? 48000}>
                <option value="48000">48 kHz</option>
                <option value="96000">96 kHz (scaled estimate)</option>
              </select>
            </label>
            <button type="submit">Apply traffic</button>
            <button
              type="button"
              onClick={() =>
                store.api
                  .getState()
                  .setConnectionTraffic(connection.id, undefined)
              }
            >
              Clear declaration
            </button>
          </form>
          <p>
            {traffic
              ? `${trafficMbps(traffic).toFixed(1)} Mb/s estimated for this subscription`
              : "Traffic unknown until declared"}
            . Approx. 6 Mb/s per 4-channel 48 kHz unicast flow. Multicast and
            switch topology excluded.
          </p>
        </>
      ) : (
        <p>
          Connect Dante or Ethernet ports to declare a Dante subscription. The
          scenario panel can also budget hypothetical extra flows.
        </p>
      )}
      <ul>
        {audit.missingRequired.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  );
}
