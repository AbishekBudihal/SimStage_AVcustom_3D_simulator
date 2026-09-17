import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useStore } from "zustand";
import type { DeviceStore, Endpoint } from "../workspace/DeviceStore";
import {
  connectionDistance,
  nodeHeight,
  nodePosition,
  NODE_WIDTH,
  portPoint,
  wirePath,
} from "../workspace/SchematicModel";
const colors: Record<string, string> = {
  HDMI: "#65adff",
  Dante: "#61d7af",
  "USB-C": "#ba9bff",
  Power: "#f0b876",
};
export function SchematicCanvas({ store }: { store: DeviceStore }) {
  const state = useStore(store.api);
  const devices = Object.values(state.devices).filter((d) => d !== undefined);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [pending, setPending] = useState<Endpoint | null>(null);
  const [error, setError] = useState("");
  const [wire, setWire] = useState<string | null>(null);
  const drag = useRef<{
    id: string | null;
    pointer: number;
    x: number;
    y: number;
    origin: { x: number; y: number };
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  function fit() {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || !devices.length) return;
    const positions = devices.map((d, i) => ({
      ...nodePosition(state, d.id, i),
      height: nodeHeight(d),
    }));
    const left = Math.min(...positions.map((p) => p.x)) - 40,
      top = Math.min(...positions.map((p) => p.y)) - 40;
    const width =
        Math.max(...positions.map((p) => p.x + NODE_WIDTH)) + 40 - left,
      height = Math.max(...positions.map((p) => p.y + p.height)) + 40 - top;
    const zoom = Math.max(
      0.25,
      Math.min(1, rect.width / width, rect.height / height),
    );
    setView({
      x: -left * zoom + (rect.width - width * zoom) / 2,
      y: -top * zoom + (rect.height - height * zoom) / 2,
      zoom,
    });
  }
  useEffect(() => {
    fit();
  }, []);
  function start(
    event: PointerEvent<SVGElement>,
    id: string | null,
    origin: { x: number; y: number },
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    drag.current = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin,
    };
    if (id) store.api.getState().selectDevice(id);
  }
  function end(cancel = false) {
    const current = drag.current;
    drag.current = null;
    if (current && cancel) {
      if (current.id && store.get(current.id))
        store.api.getState().moveNode(current.id, current.origin);
      else if (!current.id) setView((v) => ({ ...v, ...current.origin }));
    }
    if (current && svg.current?.hasPointerCapture(current.pointer))
      svg.current.releasePointerCapture(current.pointer);
  }
  return (
    <div className="schematic-pane">
      <div className="schematic-controls">
        <span>
          Output → input · Drag nodes · Pan background · Wheel to zoom
        </span>
        <button onClick={fit}>Fit diagram</button>
        <button
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.min(2.5, v.zoom * 1.2) }))
          }
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.max(0.25, v.zoom / 1.2) }))
          }
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          disabled={!wire}
          onClick={() => {
            if (wire) store.api.getState().disconnect(wire);
            setWire(null);
          }}
        >
          Delete wire
        </button>
      </div>
      <div className="schematic-message" role="status">
        {error ||
          (pending
            ? `Connect ${pending.portId} to a compatible input. Esc cancels.`
            : `${state.connections.length} physical connections · protocol and PoE checks excluded`)}
      </div>
      <svg
        ref={svg}
        className="schematic-svg"
        tabIndex={0}
        aria-label="Signal flow editor"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPending(null);
            setError("");
            end(true);
          }
          if ((e.key === "Delete" || e.key === "Backspace") && wire) {
            e.preventDefault();
            store.api.getState().disconnect(wire);
            setWire(null);
          }
        }}
        onPointerDown={(e) => start(e, null, { x: view.x, y: view.y })}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.pointer !== e.pointerId) return;
          const position = {
            x: d.origin.x + (e.clientX - d.x) / (d.id ? view.zoom : 1),
            y: d.origin.y + (e.clientY - d.y) / (d.id ? view.zoom : 1),
          };
          if (d.id) {
            if (store.get(d.id)) store.api.getState().moveNode(d.id, position);
          } else setView((v) => ({ ...v, ...position }));
        }}
        onPointerUp={() => end()}
        onPointerCancel={() => end(true)}
        onLostPointerCapture={() => end(true)}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left,
            y = e.clientY - rect.top;
          setView((v) => {
            const zoom = Math.max(
              0.25,
              Math.min(2.5, v.zoom * Math.exp(-e.deltaY * 0.001)),
            );
            return {
              x: x - ((x - v.x) * zoom) / v.zoom,
              y: y - ((y - v.y) * zoom) / v.zoom,
              zoom,
            };
          });
        }}
      >
        <defs>
          <pattern
            id="schematic-grid"
            width={24 * view.zoom}
            height={24 * view.zoom}
            patternUnits="userSpaceOnUse"
            x={view.x}
            y={view.y}
          >
            <circle cx="1" cy="1" r="0.8" fill="#354251" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#schematic-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {state.connections.map((c) => {
            const a = state.devices[c.from.deviceId],
              b = state.devices[c.to.deviceId];
            if (!a || !b) return null;
            const from = portPoint(
                a,
                c.from.portId,
                nodePosition(state, a.id, devices.indexOf(a)),
              ),
              to = portPoint(
                b,
                c.to.portId,
                nodePosition(state, b.id, devices.indexOf(b)),
              );
            return (
              <g
                key={c.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setWire(c.id);
                  setPending(null);
                }}
              >
                <path
                  d={wirePath(from, to)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                />
                <path
                  d={wirePath(from, to)}
                  fill="none"
                  stroke={colors[c.signal] ?? "#fff"}
                  strokeWidth={wire === c.id ? 4 : 2}
                />
                <title>
                  {c.signal}: {connectionDistance(c, state)?.toFixed(2)} m
                  straight-line minimum
                </title>
              </g>
            );
          })}
          {devices.map((d, index) => {
            const pos = nodePosition(state, d.id, index);
            return (
              <g key={d.id} transform={`translate(${pos.x} ${pos.y})`}>
                <rect
                  width={NODE_WIDTH}
                  height={nodeHeight(d)}
                  rx="10"
                  fill="#1c2633"
                  stroke={state.selectedId === d.id ? "#7bbcff" : "#435165"}
                  strokeWidth={state.selectedId === d.id ? 2 : 1}
                />
                <rect
                  width={NODE_WIDTH}
                  height="50"
                  rx="10"
                  fill="#27384b"
                  onPointerDown={(e) => start(e, d.id, pos)}
                />
                <text
                  x="14"
                  y="22"
                  fill="#eef5ff"
                  fontSize="12"
                  pointerEvents="none"
                >
                  {d.metadata.label.slice(0, 30)}
                </text>
                <text
                  x="14"
                  y="40"
                  fill="#9fb4cb"
                  fontSize="10"
                  pointerEvents="none"
                >
                  {d.position.x.toFixed(1)}, {d.position.y.toFixed(1)},{" "}
                  {d.position.z.toFixed(1)} m
                </text>
                {d.ports.map((p, i) => {
                  const input = p.direction === "input",
                    x = input ? 0 : NODE_WIDTH,
                    y = 76 + i * 24;
                  return (
                    <g
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${d.metadata.label} ${p.id}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.currentTarget.dispatchEvent(
                            new MouseEvent("click", { bubbles: true }),
                          );
                        }
                      }}
                      onClick={() => {
                        setError("");
                        if (
                          !input &&
                          !(
                            p.direction === "bidirectional" &&
                            pending &&
                            pending.deviceId !== d.id
                          )
                        ) {
                          setPending({ deviceId: d.id, portId: p.id });
                          return;
                        }
                        if (!pending) {
                          setError("Choose an output port first.");
                          return;
                        }
                        try {
                          store.api
                            .getState()
                            .connect(pending, { deviceId: d.id, portId: p.id });
                          setPending(null);
                        } catch (cause) {
                          setError((cause as Error).message);
                        }
                      }}
                    >
                      <title>
                        {p.connector ?? p.signal}
                        {p.notes ? `: ${p.notes}` : ""}
                      </title>
                      <circle cx={x} cy={y} r="10" fill="transparent" />
                      <circle
                        cx={x}
                        cy={y}
                        r="5"
                        fill={colors[p.signal] ?? "#aaa"}
                        stroke={
                          pending?.deviceId === d.id && pending.portId === p.id
                            ? "white"
                            : "none"
                        }
                        strokeWidth="3"
                      />
                      <text
                        x={input ? 13 : NODE_WIDTH - 13}
                        y={y + 4}
                        fill="#b9c9d9"
                        fontSize="10"
                        textAnchor={input ? "start" : "end"}
                      >
                        {p.label}
                      </text>
                    </g>
                  );
                })}
                {!d.ports.length && (
                  <text x="14" y="78" fill="#8b9bac" fontSize="11">
                    Port definitions not supplied
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
