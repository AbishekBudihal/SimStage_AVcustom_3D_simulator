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
no obstacles/reflections and no phase interference. Generic references are omnidirectional. Manufacturer loudspeakers use sensitivity + 10 log10(drive Watts), capped at published continuous SPL, then an approximate conical attenuation of min(30, 6 × (off-axis / half-coverage-angle)^2) dB. This smooth curve is an assumption, not measured polar data. Zero drive contributes no sound.
Distances below 1 m are clamped because this far-field approximation should not
extrapolate near-field gain. Reference SPL is the operating level at 1 m, not a
speaker's rated electrical power or sensitivity alone. Drive power is separate from mains power and does not imply a connected amplifier. Heatmap values are
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
on one input, and treats physical connectors as point-to-point in either direction. Generic logical Dante ports retain their earlier fanout behavior. It does not negotiate
HDMI bandwidth/HDCP, USB roles, Dante channel counts, PoE or DSP processing.
Wires persist by endpoint ID during spatial movement. Hover length is a straight-line
minimum, excluding tray routes, slack and service loops. Schematics do not perform
obstacle-avoiding routing. Manufacturer envelopes are applied to procedural models; these are not manufacturer CAD assets. Hardware profiles include sources and distinguish physical jacks from logical channels. USB roles, adapters and network protocol interoperability still require engineering review.

## Validation and performance

`npm run build` and `npm test` target the active workspace; legacy files remain
outside its build. Tests cover graph integrity, transformations, snapping, resource
cleanup, SPL identities and unknown-data handling. Demand rendering removes idle
frames; cached geometry and instanced overlays reduce allocation/draw calls.
60 FPS remains hardware- and scene-dependent; no universal frame-rate guarantee.
State is session-only. No cloud save, licensed certification or real-time acoustic
measurement is implied by this implementation.

## Source catalog and parametric rooms

The active catalog is `catalog.ts`, parsed from all 83 records in the five supplied `data/*.json` files. Original records, IDs, dimensions in metres, provenance and source descriptions remain available in the inspector. Explicit ports retain their IDs, direction, connector, transport and signal types. Display connectivity counts expand into sockets with the inference identified. Unspecified ports are not invented.

The supplied records contain no structured electrical loads. Watts and BTU/h remain null until provided. JSON imports accept `powerWatts` and `heatBtuPerHour`, or `electrical.powerWatts` and `thermal.heatBtuPerHour`; one is never inferred from the other. Speaker power-rating strings are not interpreted as mains consumption. Sensitivity-based SPL starts with an explicit, editable 1 W assumption, with impedance and tap conditions unverified. The previous curated HardwareCatalog module is retained only for regression fixtures and is not an application catalog.

Import accepts arrays in the existing simulator schema, validates the entire batch, rejects duplicate IDs, and publishes atomically to Zustand. Existing placed device specifications remain immutable snapshots. Imports are session-only. User-defined placeholders are hidden by default and can be shown explicitly.

Room dimensions initialize from `createDefaultRoom()` in the supplied RoomModel (10 x 7 x 3.2 m). Width/length accept 3–30 m and height 2–8 m. Valid edits update the room and mounting anchors atomically; walls and ceiling move, table anchors reclamp, and device IDs and wires persist. Conference seats use 0.85 m spacing. Training rows/columns use 3.6 x 1.6 m bays and perimeter clearance. These are furniture planning assumptions, not accessibility certification.

Visual seat markers and cyan viewing-region boundaries use the same live image height, orientation, content and angle checks. Boundaries sample the region at 0.25 m on the 1.2 m seating plane and project it onto the floor; they are discrete planning contours, not certified DISCAS boundaries. Unknown image heights produce no region. SPL samples use live speaker coordinates and room dimensions. All placed devices contribute; selection only controls the inspector.


## Capacity and semantic placement

Room state now accepts `roomType` and optional `capacity` (0–200). Eight semantic types map to meeting-table or teaching-desk layouts. Capacity is a request: seating stops at the available geometric capacity and the audit reports any shortfall. Presets populate editable fields only. A missing capacity retains automatic sizing. These spacing rules are design assumptions, not circulation/accessibility certification.

Products added by clicking inventory or by schematic import without XYZ receive an automatic placement intent: mainDisplayWall, aboveMainDisplay, ceilingGrid, table, frontWall or rearRoom. Room changes and device edits solve these intents in one store publication. Moving, rotating or remounting a device marks it manual. Manual transforms survive resizing, even if now outside the envelope; the audit flags those positions. The inspector can explicitly reapply automatic placement. Escape restores the previous drag placement mode.

Schematic JSON import adds nodes from existing catalog IDs and validates all endpoints transactionally before publishing. Format:

```json
{"nodes":[{"id":"display","catalogId":"samsung-qm75b"},{"id":"camera","catalogId":"yealink-uvc86"}],"connections":[{"from":{"deviceId":"camera","portId":"hdmi-out"},"to":{"deviceId":"display","portId":"hdmi-1"}}]}
```

Optional node `position` and `rotation` use XYZ objects in metres and radians and preserve explicit engineer transforms. Arbitrary schematic drawing/PDF formats are not parsed. This path uses the active DeviceStore; no AppState synchronization layer or second persistent model exists. Rack-unit metadata and straight-line cable estimates remain available; rack allocation and installation cable routing have not been added.

The procedural room includes a downward-facing ceiling (open from above), dimension-driven ceiling lights, floor seams, furniture groups and demand-rendered shadows. No static room model is loaded. There is no full collision solver or guarantee that equipment footprints cannot overlap.
