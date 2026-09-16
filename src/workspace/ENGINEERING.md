# Dual-engine workspace: engineering basis and limitations

## Architecture

- `DeviceStore.ts`: authoritative immutable devices, ports, connections, schematic
  positions and engineering assumptions. Deleting a device removes incident wires;
  changing ports removes invalid connections in the same state update.
- `SpatialAssets.ts` / `RoomLayout.ts`: cached procedural equipment, cutaway shell,
  conference table and seating. Mounting anchors use metres with Y up.
- `CanvasManager.ts`: incremental scene synchronization, demand rendering and an
  instanced 0.5 m acoustic overlay. Cameras are orthographic or seated perspective.
- `SchematicCanvas.tsx`: pan/zoom SVG graph, movable nodes, compatible port wiring,
  selectable/removable connections and cubic rounded orthogonal trunks.
- `Engineering.ts`: pure calculations shared by the audit and heatmap. Unknown
  inputs remain unknown. All numbers are planning estimates, not certification.

## Visual calculations

The 4/6/8 image-height rule is a selectable legacy planning heuristic, **not DISCAS**.
BDM distance uses `imageHeight × elementPercent / 100 × 200`, following AVIXA's
public acuity-factor and element-size material. The pass indicator requires both
this content-derived limit and the selected heuristic limit. These are independent
planning filters, not a full implementation of the DISCAS standard.

Coordinates are transformed into the rotated display frame. A seat behind the
image fails. Horizontal off-axis is measured from image-centre normal; the default
60° and vertical top-of-image 30° limits are adjustable project assumptions.
AVIXA's complete horizontal viewing region is edge-based, so the centre-angle
check must not be reported as verified DISCAS conformance. No occlusion, visual
acuity assessment or certified ADM implementation is included.

Source: https://www.avixa.org/resources/display-image-size-calculators/learn-more-about-display-size

## Acoustic calculations

Direct sound: `L(r) = L(1m) − 20 log10(max(1m, r))`. Multiple specified sources
are summed by incoherent energy (`10 log10(sum(10^(L/10)))`). This assumes
omnidirectional sources, no obstacles/reflections and no phase interference.
Distances below 1 m are clamped because this far-field approximation should not
extrapolate near-field gain. Reference SPL is the operating level at 1 m, not a
speaker's rated electrical power or sensitivity alone. Heatmap values are
calculated at 1.2 m ear height and projected onto the floor for visualization.
Unknown speaker levels yield partial coverage, explicitly flagged in the audit.

The optional intelligibility layer is a **broadband MTF proxy, not STI/STIPA**.
With entered RT60 and background noise, modulation is approximated at 14
frequencies from 0.63–12.5 Hz using:

`m(f) = (1 + (2πf RT60 / 13.8)^2)^(-1/2) / (1 + 10^(-SNR/10))`

Effective SNR is `10 log10(m/(1-m))`, clipped to ±15 dB and normalized to 0–1;
the proxy is the unweighted mean. It omits octave-band weighting/redundancy,
auditory masking, echo response and certified IEC processing. Null noise/RT60/SPL
produces no result. The illustrative preset (78 dB at 1 m, 40 dB noise, 0.6 s RT60)
is user-triggered and must be replaced by project data. Certified STI requires
validated spectral/acoustic input and measurement or a validated prediction tool.

Context: https://www.nti-audio.com/en/support/know-how/how-do-we-measure-speech-intelligibility-sti

## Loads, wiring and score

Power/heat sums include specified values only. Budget defaults are editable project
assumptions, not regulatory circuit ratings. Readiness is 20 points each for:
visual planning checks, acoustic target, complete power within budget, complete
thermal load within budget, and no unconnected inputs. Unused optional inputs can
therefore reduce readiness. This transparent score is not an AVIXA health score.

Port compatibility matches signal type and direction, prevents multiple sources
on one input, and treats non-Dante outputs as point-to-point. It does not negotiate
HDMI bandwidth/HDCP, USB roles, Dante channel counts, PoE or DSP processing.
Wires persist by endpoint ID during spatial movement. Hover length is a straight-line
minimum, excluding tray routes, slack and service loops. Schematics do not perform
obstacle-avoiding routing. Devices use illustrative generic geometry/ports; verified
manufacturer specifications are not bundled.

## Validation and performance

`npm run build` and `npm test` target the active workspace; legacy files remain
outside its build. Tests cover graph integrity, transformations, snapping, resource
cleanup, SPL identities and unknown-data handling. Demand rendering removes idle
frames; cached geometry and instanced overlays reduce allocation/draw calls.
60 FPS remains hardware- and scene-dependent; no universal frame-rate guarantee.
State is session-only. No cloud save, licensed certification or real-time acoustic
measurement is implied by this implementation.
