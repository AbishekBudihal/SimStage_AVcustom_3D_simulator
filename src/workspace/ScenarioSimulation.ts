import type { DeviceState, PlacedDevice, Connection } from "./DeviceStore";
import { roomLayout } from "./RoomLayout";
import { microphonePoint } from "./AudioEngineering";
import { intelligibilityProxy } from "./Engineering";
export type ScenarioInput = Pick<
  DeviceState,
  "room" | "devices" | "connections" | "engineering"
>;
export interface ScenarioConfig {
  iterations: number;
  seed: number;
  occupancyMin: number;
  occupancyMax: number;
  noiseMin: number;
  noiseMax: number;
  occupiedNoiseRise: number;
  rt60Min: number | null;
  rt60Max: number | null;
  speechDb: number;
  proxyThreshold: number;
  requiredPassPercent: number;
  extraFlowsMin: number;
  extraFlowsMax: number;
  linkMbps: number | null;
  otherTrafficMbps: number;
  utilizationLimit: number;
}
export const DEFAULT_SCENARIO: Readonly<ScenarioConfig> = Object.freeze({
  iterations: 300,
  seed: 42,
  occupancyMin: 25,
  occupancyMax: 100,
  noiseMin: 35,
  noiseMax: 50,
  occupiedNoiseRise: 6,
  rt60Min: null,
  rt60Max: null,
  speechDb: 60,
  proxyThreshold: 0.6,
  requiredPassPercent: 95,
  extraFlowsMin: 0,
  extraFlowsMax: 16,
  linkMbps: null,
  otherTrafficMbps: 0,
  utilizationLimit: 0.7,
});
export function validateScenario(c: ScenarioConfig): void {
  if (
    Object.values(c).some((n) => n !== null && !Number.isFinite(n)) ||
    !Number.isInteger(c.iterations) ||
    c.iterations < 10 ||
    c.iterations > 5000 ||
    !Number.isInteger(c.seed) ||
    c.seed < 0 ||
    c.seed > 4294967295 ||
    c.occupancyMin < 1 ||
    c.occupancyMax > 100 ||
    c.occupancyMin > c.occupancyMax ||
    c.noiseMin < 0 ||
    c.noiseMax > 120 ||
    c.noiseMin > c.noiseMax ||
    c.occupiedNoiseRise < 0 ||
    c.occupiedNoiseRise > 30 ||
    c.speechDb < 30 ||
    c.speechDb > 100 ||
    c.proxyThreshold <= 0 ||
    c.proxyThreshold > 1 ||
    c.requiredPassPercent <= 0 ||
    c.requiredPassPercent > 100 ||
    (c.rt60Min !== null && (c.rt60Min <= 0 || c.rt60Min > 20)) ||
    (c.rt60Max !== null && (c.rt60Max <= 0 || c.rt60Max > 20)) ||
    (c.rt60Min !== null && c.rt60Max !== null && c.rt60Min > c.rt60Max) ||
    !Number.isInteger(c.extraFlowsMin) ||
    !Number.isInteger(c.extraFlowsMax) ||
    c.extraFlowsMin < 0 ||
    c.extraFlowsMax > 10000 ||
    c.extraFlowsMin > c.extraFlowsMax ||
    (c.linkMbps !== null && (c.linkMbps <= 0 || c.linkMbps > 100000)) ||
    c.otherTrafficMbps < 0 ||
    c.otherTrafficMbps > 100000 ||
    c.utilizationLimit <= 0 ||
    c.utilizationLimit > 1
  )
    throw new Error("Invalid scenario range or threshold");
}
export interface DanteTraffic {
  channels: number;
  sampleRate: 48000 | 96000;
  receivers: number;
}
export function validateTraffic(t: DanteTraffic) {
  if (
    !Number.isInteger(t.channels) ||
    t.channels < 1 ||
    t.channels > 512 ||
    ![48000, 96000].includes(t.sampleRate) ||
    !Number.isInteger(t.receivers) ||
    t.receivers < 1 ||
    t.receivers > 256
  )
    throw new Error("Invalid Dante unicast subscription");
}
/** Approximate conservative unicast budget: up to four 48 kHz channels per ~6 Mb/s flow. */
export function trafficMbps(t: DanteTraffic): number {
  validateTraffic(t);
  return Math.ceil(t.channels / 4) * 6 * (t.sampleRate / 48000) * t.receivers;
}
export function isDante(c: Connection, state?: ScenarioInput): boolean {
  return (
    /dante/i.test(c.signal) ||
    (!!state &&
      [c.from, c.to].some((e) => {
        const p = state.devices[e.deviceId]?.ports.find(
          (p) => p.id === e.portId,
        );
        return /dante/i.test(`${p?.label ?? ""} ${p?.transport ?? ""}`);
      }))
  );
}
export function canDeclareTraffic(c: Connection): boolean {
  return /dante|ethernet|network/i.test(c.signal);
}
export function signalAudit(state: ScenarioInput) {
  const missingRequired: string[] = [],
    unknownPorts: string[] = [];
  for (const d of Object.values(state.devices)) {
    if (!d) continue;
    if (!d.ports.length) unknownPorts.push(d.metadata.label);
    for (const p of d.ports)
      if (
        p.required &&
        !state.connections.some(
          (c) =>
            (c.from.deviceId === d.id && c.from.portId === p.id) ||
            (c.to.deviceId === d.id && c.to.portId === p.id),
        )
      )
        missingRequired.push(`${d.metadata.label}: ${p.label}`);
  }
  const routes = state.connections
    .filter((c) => c.traffic || isDante(c, state))
    .map((c) => ({
      id: c.id,
      mbps: c.traffic ? trafficMbps(c.traffic) : null,
    }));
  return {
    missingRequired,
    unknownPorts,
    routes,
    knownMbps: routes.reduce((n, r) => n + (r.mbps ?? 0), 0),
    unknownTraffic: routes.filter((r) => r.mbps === null).length,
  };
}
export type Verdict = "pass" | "fail" | "unverified";
export interface Trial {
  occupants: number;
  noiseDb: number;
  rt60: number | null;
  extraFlows: number;
  mbps: number;
  proxy: number | null;
  acoustic: Verdict;
  network: Verdict;
}
export interface ScenarioReport {
  status: Verdict;
  passPercent: number;
  acousticPassPercent: number;
  networkPassPercent: number;
  unknownTrials: number;
  iterations: number;
  seed: number;
  worst: Trial;
  p95Mbps: number;
  minProxy: number | null;
  reasons: string[];
  audit: ReturnType<typeof signalAudit>;
}
/** Pure seeded sampling. Occupancy chooses existing seats without changing the layout. */
export function runScenarios(
  state: ScenarioInput,
  c: ScenarioConfig,
): ScenarioReport {
  validateScenario(c);
  let seed = c.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sample = (lo: number, hi: number) => lo + (hi - lo) * random();
  const seats = roomLayout(state.room).seats;
  const mics = Object.values(state.devices).filter(
    (d): d is PlacedDevice => !!d && d.kind === "ceiling_mic",
  );
  const paths = seats.map((s) =>
    mics.map((d) => microphonePoint(d, s.position)),
  );
  const audit = signalAudit(state),
    trials: Trial[] = [];
  let passes = 0,
    acousticPass = 0,
    networkPass = 0,
    unknownTrials = 0;
  for (let i = 0; i < c.iterations; i++) {
    const occupants = Math.min(
      seats.length,
      Math.max(
        1,
        Math.ceil(
          (seats.length * sample(c.occupancyMin, c.occupancyMax)) / 100,
        ),
      ),
    );
    const noiseDb =
      sample(c.noiseMin, c.noiseMax) +
      10 *
        Math.log10(
          1 +
            (occupants / Math.max(1, seats.length)) *
              (10 ** (c.occupiedNoiseRise / 10) - 1),
        );
    const rt60 =
      c.rt60Min === null || c.rt60Max === null
        ? null
        : sample(c.rt60Min, c.rt60Max);
    const extraFlows =
      c.extraFlowsMin +
      Math.floor(random() * (c.extraFlowsMax - c.extraFlowsMin + 1));
    const mbps = audit.knownMbps + extraFlows * 6 + c.otherTrafficMbps;
    const network: Verdict =
      c.linkMbps === null
        ? "unverified"
        : mbps > c.linkMbps * c.utilizationLimit
          ? "fail"
          : audit.unknownTraffic
            ? "unverified"
            : "pass";
    const indices = seats.map((_, j) => j);
    for (let j = 0; j < occupants; j++) {
      const k = j + Math.floor(random() * (indices.length - j));
      [indices[j], indices[k]] = [indices[k], indices[j]];
    }
    let acoustic: Verdict = occupants ? "pass" : "unverified",
      proxy: number | null = null;
    for (const index of indices.slice(0, occupants)) {
      let best: number | null = null,
        unknown = !mics.length,
        possible = false;
      for (const path of paths[index]) {
        if (path.status === "unknown") {
          unknown = true;
          continue;
        }
        if (path.status === "outside") continue;
        possible = true;
        const value = intelligibilityProxy(
          c.speechDb - 20 * Math.log10(Math.max(1, path.distance)),
          noiseDb,
          rt60,
        );
        if (value === null) unknown = true;
        else best = Math.max(best ?? 0, value);
      }
      const outcome: Verdict =
        best !== null && best >= c.proxyThreshold
          ? "pass"
          : unknown
            ? "unverified"
            : "fail";
      // Known geometric failure remains a failure even without RT60.
      const seatStatus = !possible && !unknown ? "fail" : outcome;
      if (seatStatus === "fail") acoustic = "fail";
      else if (seatStatus === "unverified" && acoustic !== "fail")
        acoustic = "unverified";
      if (best !== null) proxy = Math.min(proxy ?? 1, best);
    }
    if (acoustic === "pass") acousticPass++;
    if (network === "pass") networkPass++;
    if (acoustic === "pass" && network === "pass") passes++;
    if (acoustic === "unverified" || network === "unverified") unknownTrials++;
    trials.push({
      occupants,
      noiseDb,
      rt60,
      extraFlows,
      mbps,
      proxy,
      acoustic,
      network,
    });
  }
  const percent = (n: number) => (100 * n) / c.iterations;
  const passPercent = percent(passes),
    reasons: string[] = [];
  if (!seats.length) reasons.push("No generated seats to test");
  if (!mics.length) reasons.push("No microphones to test");
  if (c.rt60Min === null || c.rt60Max === null)
    reasons.push("RT60 range is missing; intelligibility proxy is unverified");
  if (c.linkMbps === null)
    reasons.push("Shared bottleneck link capacity is missing");
  if (audit.unknownTraffic)
    reasons.push(
      `${audit.unknownTraffic} Dante connections need traffic declarations`,
    );
  if (audit.missingRequired.length)
    reasons.push(
      `${audit.missingRequired.length} required ports are unconnected`,
    );
  if (audit.unknownPorts.length)
    reasons.push(`${audit.unknownPorts.length} devices have unspecified ports`);
  const bestPossible = percent(
    passes +
      trials.filter(
        (t) =>
          (t.acoustic === "unverified" || t.network === "unverified") &&
          t.acoustic !== "fail" &&
          t.network !== "fail",
      ).length,
  );
  const status: Verdict =
    audit.missingRequired.length || bestPossible < c.requiredPassPercent
      ? "fail"
      : unknownTrials || audit.unknownPorts.length
        ? "unverified"
        : passPercent >= c.requiredPassPercent
          ? "pass"
          : "fail";
  if (status === "fail")
    reasons.push("Configured scenario acceptance policy failed");
  const ordered = [...trials].sort((a, b) => a.mbps - b.mbps);
  const worst = [...trials].sort((a, b) => {
    const score = (t: Trial) =>
      (t.acoustic === "fail" ? 4 : 0) +
      (t.network === "fail" ? 4 : 0) +
      (t.acoustic === "unverified" ? 2 : 0) +
      (t.network === "unverified" ? 2 : 0);
    return (
      score(b) - score(a) || (a.proxy ?? 1) - (b.proxy ?? 1) || b.mbps - a.mbps
    );
  })[0];
  const proxies = trials.flatMap((t) => (t.proxy === null ? [] : [t.proxy]));
  return {
    status,
    passPercent,
    acousticPassPercent: percent(acousticPass),
    networkPassPercent: percent(networkPass),
    unknownTrials,
    iterations: c.iterations,
    seed: c.seed,
    worst,
    p95Mbps: ordered[Math.ceil(c.iterations * 0.95) - 1].mbps,
    minProxy: proxies.length ? Math.min(...proxies) : null,
    reasons,
    audit,
  };
}
