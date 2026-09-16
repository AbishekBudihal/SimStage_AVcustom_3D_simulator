import {
  snapToSurface,
  type DeviceKind,
  type DevicePort,
  type MountSurface,
  type NewDevice,
  type RoomSize,
  type XYZ,
} from "./DeviceStore";
export interface HardwareProfile {
  id: string;
  manufacturer: string;
  model: string;
  kind: DeviceKind;
  surface: MountSurface;
  icon: string;
  dimensions: XYZ;
  powerWatts: number;
  powerBasis: string;
  heatBtuPerHour: number;
  heatBasis: string;
  ports: readonly DevicePort[];
  sources: readonly string[];
  notes: string;
  imageHeightM?: number;
  sensitivityDb?: number;
  maxSpeakerWatts?: number;
  coverageDegrees?: number;
  maxSpl?: number;
  rackUnits?: number;
}
const p = (
  id: string,
  signal: string,
  direction: DevicePort["direction"],
  connector: string,
  notes?: string,
): DevicePort => ({ id, label: id, signal, direction, connector, notes });
const ethernet = (id: string, notes: string) =>
  p(id, "Ethernet", "bidirectional", "RJ45", notes);
const heat = (watts: number) => Math.round(watts * 3.412141633 * 10) / 10;
const derived =
  "Calculated electrical-equivalent heat: W × 3.412142; not measured thermal dissipation";
const samsungPorts = () => [
  ...[1, 2, 3].map((i) => p(`HDMI ${i}`, "HDMI", "input", "HDMI Type A")),
  p("DisplayPort", "DisplayPort", "input", "DisplayPort"),
  ...[1, 2].map((i) =>
    p(
      `USB ${i}`,
      "USB",
      "bidirectional",
      "USB",
      "Media/service; not USB-C video",
    ),
  ),
  p("IR in", "IR", "input", "IR connector"),
  p("Audio out", "Analog audio", "output", "3.5 mm stereo"),
  p("RS232 in", "RS232", "input", "RS232"),
  p("RS232 out", "RS232", "output", "RS232"),
  ethernet("LAN", "Control network; not Dante"),
  p("AC in", "AC mains", "input", "AC inlet"),
];
const samsung = (size: 75 | 85): HardwareProfile => ({
  id: `samsung-qm${size}c`,
  manufacturer: "Samsung",
  model: `QM${size}C · ${size}″ 4K`,
  kind: "display",
  surface: "north",
  icon: "▣",
  dimensions:
    size === 75
      ? { x: 1.6823, y: 0.9604, z: 0.0285 }
      : { x: 1.9043, y: 1.0853, z: 0.0285 },
  imageHeightM: (2160 * (size === 75 ? 0.429 : 0.487)) / 1000,
  powerWatts: size === 75 ? 214.5 : 330,
  powerBasis: "Published on-mode consumption (regional XXS model)",
  heatBtuPerHour: heat(size === 75 ? 214.5 : 330),
  heatBasis: derived,
  ports: samsungPorts(),
  sources: [
    `https://www.samsung.com/sg/business/smart-signage/uhd-4k-signage/crystal-uhd-signage-qmc-${size}-inch-lh${size}qmcebgcxxs/`,
  ],
  notes:
    "Dimensions exclude stand. Active image height derived from published pixel pitch × 2160. USB connector subtype is not specified on this regional spec page; no USB-C input is claimed.",
});
export const HARDWARE_CATALOG: readonly HardwareProfile[] = [
  samsung(75),
  samsung(85),
  {
    id: "shure-mxa920-s",
    manufacturer: "Shure",
    model: "MXA920-S (24 inch)",
    kind: "ceiling_mic",
    surface: "ceiling",
    icon: "⊙",
    dimensions: { x: 0.6038, y: 0.05469, z: 0.6038 },
    powerWatts: 10.1,
    powerBasis: "Maximum PoE Class 0 load",
    heatBtuPerHour: heat(10.1),
    heatBasis: derived,
    ports: [
      ethernet(
        "Dante / PoE",
        "One physical RJ45 carries Dante audio, control and PoE Class 0",
      ),
    ],
    sources: ["https://pubs.shure.com/view/guide/MXA920/en-US.pdf"],
    notes:
      "US 24-inch square variant, not the 60 cm model. Requires a PoE source. Do not count its one RJ45 as separate audio and power sockets.",
  },
  {
    id: "qsys-core8flex",
    manufacturer: "Q-SYS",
    model: "Core 8 Flex",
    kind: "dsp",
    surface: "table",
    icon: "≋",
    dimensions: { x: 0.22, y: 0.0436, z: 0.2866 },
    powerWatts: 40,
    powerBasis: "Typical; published maximum 60 W",
    heatBtuPerHour: 136,
    heatBasis: "Manufacturer-published heat load",
    rackUnits: 1,
    ports: [
      ...Array.from({ length: 8 }, (_, i) =>
        p(
          `Flex ${i + 1}`,
          "Analog audio",
          "bidirectional",
          "3-pin terminal",
          "Configurable input OR output",
        ),
      ),
      ethernet(
        "LAN A",
        "Q-LAN / AES67 / Dante / control; 8×8 Dante included, no PoE output",
      ),
      ethernet("LAN B", "Redundant network; no PoE output"),
      p(
        "USB-C",
        "USB",
        "bidirectional",
        "USB-C",
        "Host/DP/device; device role exclusive with USB-B",
      ),
      p("USB-B", "USB", "bidirectional", "USB-B 3.0"),
      ...Array.from({ length: 4 }, (_, i) =>
        p(`USB-A ${i + 1}`, "USB", "bidirectional", "USB-A 3.0"),
      ),
      p("COM 1", "RS232", "bidirectional", "3-pin 3.5 mm terminal"),
      p("COM 2", "RS232", "bidirectional", "3-pin 3.5 mm terminal"),
      p(
        "GPIO",
        "GPIO",
        "bidirectional",
        "Terminal block",
        "8 inputs, 8 outputs and auxiliary 12 V / 0.1 A supply",
      ),
      p("AC in", "AC mains", "input", "IEC C14"),
    ],
    sources: [
      "https://www.qsys.com/products-solutions/q-sys/processing/core-8-flex/",
      "https://help.qsys.com/q-sys_9.0/Content/Hardware/Cores/Core_8_Flex.htm",
    ],
    notes:
      "Half-rack 1RU. Flex channels need direction configuration in the real DSP. Physical Ethernet wires are not Dante subscriptions.",
  },
  {
    id: "biamp-tesiraforte-x400",
    manufacturer: "Biamp",
    model: "TesiraFORTÉ X 400",
    kind: "dsp",
    surface: "table",
    icon: "≋",
    dimensions: { x: 0.206, y: 0.0373, z: 0.206 },
    powerWatts: 150,
    powerBasis:
      "Conservative upper bound; datasheet states <150 W including PoE supply",
    heatBtuPerHour: heat(150),
    heatBasis:
      "Upper-bound electrical equivalent, includes power potentially exported over PoE",
    ports: [
      ...Array.from({ length: 5 }, (_, i) =>
        ethernet(
          `Network ${i + 1}`,
          i ? "PoE+ capable; network role configured in Tesira" : "1Gb network",
        ),
      ),
      p("USB-B", "USB", "bidirectional", "USB-B", "Up to 2×2 USB audio"),
      ...[1, 2].map((i) =>
        p(
          `Analog in ${i}`,
          "Analog audio",
          "input",
          "Removable screw terminal",
        ),
      ),
      ...[1, 2].map((i) =>
        p(
          `Analog out ${i}`,
          "Analog audio",
          "output",
          "Removable screw terminal",
        ),
      ),
      p("GPIO", "GPIO", "bidirectional", "4-pin terminal"),
      p(
        "DC power",
        "DC supply",
        "input",
        "DC inlet",
        "External supply; 100–240 VAC system rating",
      ),
    ],
    sources: [
      "https://downloads.biamp.com/assets/docs/default-source/data-sheets/biamp_data_sheet_tesiraforte-x400-dsp_nov25.pdf?sfvrsn=1d725234_22",
      "https://support.biamp.com/Tesira/Miscellaneous/TesiraFORTE_X",
    ],
    notes:
      "Five physical network jacks, four with PoE+. AVB/Dante channels are network capabilities, not extra RJ45 connectors. External PSU losses and exported PoE prevent treating the upper bound as exact room heat.",
  },
  {
    id: "sony-srg-x400",
    manufacturer: "Sony",
    model: "SRG-X400 PTZ",
    kind: "ptz_camera",
    surface: "table",
    icon: "◉",
    dimensions: { x: 0.1584, y: 0.1775, z: 0.2002 },
    powerWatts: 25.5,
    powerBasis: "Maximum; DC 12 V or PoE+",
    heatBtuPerHour: heat(25.5),
    heatBasis: derived,
    ports: [
      p("HDMI out", "HDMI", "output", "HDMI"),
      p("3G-SDI out", "SDI", "output", "BNC"),
      ethernet("LAN / PoE+", "Streaming / VISCA IP / PoE+"),
      p("VISCA in", "RS422", "input", "RJ45"),
      p("VISCA out", "RS422", "output", "RJ45"),
      p("Mic/line 1", "Analog audio", "input", "3.5 mm"),
      p("Mic/line 2", "Analog audio", "input", "3.5 mm"),
      p("DC 12V", "DC supply", "input", "JEITA TYPE4"),
    ],
    sources: ["https://pro.sony/ue_US/pdf/srg-x400"],
    notes:
      "Manufacturer labels dimensions approximate. 4K and NDI options may require licenses. RJ45 VISCA RS422 is not Ethernet.",
  },
  {
    id: "qsc-ad-s6t",
    manufacturer: "QSC",
    model: "AD-S6T passive speaker",
    kind: "speaker",
    surface: "north",
    icon: "◖",
    dimensions: { x: 0.215, y: 0.365, z: 0.215 },
    powerWatts: 0,
    powerBasis:
      "Passive speaker: no separate AC load; amplifier consumption excluded",
    heatBtuPerHour: 0,
    heatBasis:
      "No additional electrical load counted; account for amplifier input separately",
    sensitivityDb: 89,
    maxSpeakerWatts: 150,
    coverageDegrees: 105,
    maxSpl: 110,
    ports: [
      p("Speaker input", "Speaker-level", "input", "Euroblock"),
      p(
        "Parallel thru",
        "Speaker-level",
        "output",
        "Euroblock",
        "Passive parallel terminals; not an amplifier",
      ),
    ],
    sources: [
      "https://www.qsys.com/products-solutions/loudspeakers/installed/passive/surface-mount/acousticdesign-series/ad-s6t/",
    ],
    notes:
      "89 dB at 2.83 V / 1 m, 8Ω bypass ≈ 1 W. 150 W noise rating, 105° conical coverage, 110 dB continuous maximum. Simulation starts at an explicit 1 W drive assumption; transformer losses and frequency response are not modeled.",
  },
];
export function hardwareDevice(
  id: string,
  index: number,
  room: RoomSize,
  point?: XYZ,
): NewDevice {
  const profile = HARDWARE_CATALOG.find((p) => p.id === id);
  if (!profile) throw new Error("Unknown hardware profile");
  return {
    catalogId: profile.id,
    kind: profile.kind,
    surface: profile.surface,
    dimensions: profile.dimensions,
    position: snapToSurface(
      point ?? {
        x: profile.kind === "display" ? 0 : ((index % 3) - 1) * 0.5,
        y: 1.5,
        z: 0,
      },
      profile.surface,
      room,
    ),
    rotation: { x: 0, y: 0, z: 0 },
    ports: profile.ports,
    metadata: {
      label: `${profile.manufacturer} ${profile.model} ${index + 1}`,
      powerWatts: profile.powerWatts,
      heatBtuPerHour: profile.heatBtuPerHour,
      rackUnits: profile.rackUnits ?? null,
      imageHeightM: profile.imageHeightM,
      powerBasis: profile.powerBasis,
      heatBasis: profile.heatBasis,
      sensitivityDb: profile.sensitivityDb,
      maxSpeakerWatts: profile.maxSpeakerWatts,
      coverageDegrees: profile.coverageDegrees,
      maxSpl: profile.maxSpl,
      speakerWatts: profile.kind === "speaker" ? 1 : undefined,
      splAt1m: null,
    },
  };
}
