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

Active audio calculations live in `AudioEngineering.ts`. `Engineering.ts` re-exports the existing `directSpl` API, so the audit and new audio modes share the source-level and distance calculation. The 0.5 m sampling lattice is extracted into `ListeningGrid.ts`; seating and the shared eye/ear/voice height come from `RoomLayout.ts` (default 1.2 m, configurable). Samples are evaluated at listener height and projected onto the floor.

Microphones use preferred **3D distance**, plus a full pickup angle for an explicit cone or horizontal-sector model. Ceiling local +Z points downward before applying all three Euler rotations. Omnidirectional/radius-only models use radial geometry. Supplied beamforming/steerable array records with a radius use a clearly labelled radius-only planning envelope; no lobe shape or tracking is inferred. Missing model, angle or radius stays Unknown. Edge means the outer 10% of a specified radius or half-angle. Multiple microphones combine by coverage union: covered, then edge, then Unknown, then outside. This is geometric pickup coverage, not intelligibility or measured microphone response.

Speakers support H/V dispersion or a conical full angle with the same full transform. Both H and V are needed when either rectangular angle is supplied. Rectangular overlay faces reuse room clipping from the camera engine (`RoomClip.ts`). A nominal dispersion boundary does not mean sound ceases beyond it.

Direct sound: `L(r) = L(r0) - 20 log10(max(r0,r)/r0) - A`. Source data must supply an operating reference SPL and distance (legacy `splAt1m` uses 1 m), or sensitivity at 1 W/1 m plus explicit drive Watts. Sensitivity-derived levels are capped at supplied maximum SPL; a maximum rating alone never becomes an operating level. Drive power is separate from mains load. Zero drive contributes no sound. The imported catalog's initial 1 W assumption remains explicit and editable.

Assumed polar loss is `A = min(30, 6*(angle/halfAngle)^2)` dB for a cone, or `min(30, 6*max((H/halfH)^2,(V/halfV)^2))` for rectangular dispersion. This smooth curve is an assumption, not measured polar data. Near-field gain below the reference distance is not extrapolated. Sources sum incoherent energy, `10 log10(sum(10^(L/10)))`; never average dB. Unknown source contributors prevent a complete total. The new speaker field additionally requires known dispersion. All-muted sources yield no level.

The floor layer switches between **geometric coverage** (discrete green/amber/red/gray) and **free-field SPL estimate** (40–90 dB scale, gray Unknown). Individual contributions remain visible in selected-seat explanations. Room summary totals include every speaker; device scope evaluates only that device. No reflections, reverberation, absorption, HVAC noise, boundary gain, EQ, phase interference, occlusion or commissioning are simulated by these audio layers.

AVIXA audio coverage uniformity calls for measurement across the listening area; these estimates do not establish compliance: https://www.avixa.org/resources/standards/audio-coverage-uniformity

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

Visual seat markers and cyan viewing-region boundaries use the same live image height, orientation, content and angle checks. Boundaries sample the region at 0.25 m on the 1.2 m seating plane and project it onto the floor; they are discrete planning contours, not certified DISCAS boundaries. Unknown image heights produce no region. SPL samples use live speaker coordinates and room dimensions. Audio analysis supports all-room or selected-device scope; the room summary always includes all matching devices.


## Capacity and semantic placement

Room state now accepts `roomType` and optional `capacity` (0–200). Eight semantic types map to meeting-table or teaching-desk layouts. Capacity is a request: seating stops at the available geometric capacity and the audit reports any shortfall. Presets populate editable fields only. A missing capacity retains automatic sizing. These spacing rules are design assumptions, not circulation/accessibility certification.

Products added by clicking inventory or by schematic import without XYZ receive an automatic placement intent: mainDisplayWall, aboveMainDisplay, ceilingGrid, table, frontWall or rearRoom. Room changes and device edits solve these intents in one store publication. Moving, rotating or remounting a device marks it manual. Manual transforms survive resizing, even if now outside the envelope; the audit flags those positions. The inspector can explicitly reapply automatic placement. Escape restores the previous drag placement mode.

Schematic JSON import adds nodes from existing catalog IDs and validates all endpoints transactionally before publishing. Format:

```json
{"nodes":[{"id":"display","catalogId":"samsung-qm75b"},{"id":"camera","catalogId":"yealink-uvc86"}],"connections":[{"from":{"deviceId":"camera","portId":"hdmi-out"},"to":{"deviceId":"display","portId":"hdmi-1"}}]}
```

Optional node `position` and `rotation` use XYZ objects in metres and radians and preserve explicit engineer transforms. Arbitrary schematic drawing/PDF formats are not parsed. This path uses the active DeviceStore; no AppState synchronization layer or second persistent model exists. Rack-unit metadata and straight-line cable estimates remain available; rack allocation and installation cable routing have not been added.

The procedural room includes a downward-facing ceiling (open from above), dimension-driven ceiling lights, floor seams, furniture groups and demand-rendered shadows. No static room model is loaded. There is no full collision solver or guarantee that equipment footprints cannot overlap.


## Procedural room and verification — September 2026

The active room uses Three.js meshes throughout: rounded furniture, generated wood/fabric material maps, window frames, low wall wainscot, a seamless studio ground and a downward-facing ceiling/light strips. ACES tone mapping, hemisphere fill and a directional key create demand-rendered contact shadows; the 2048 px shadow camera tracks room size. These visual lighting/material choices are not photometric or acoustic material simulations. Generated textures, geometries and materials are disposed on room replacement/unmount.

Automatic wall placement searches free horizontal anchors around displays; table devices search free 0.5 m anchors inside the tabletop where space permits. Manual transforms remain unchanged. This is simple envelope spacing, not a full collision or clearance solver; crowded scenes still require review.

Validation: 121/121 active workspace Vitest cases passed and production build succeeded. Coverage instrumentation was not run. The existing large bundle warning remains; 60 FPS was not benchmarked. Browser verification included microphone addition, pickup radius/angle edits, yaw, drag (9 to 5 covered seats), adding another microphone (room coverage restored to 9/9), and overlay orbit alignment. Speaker verification covered missing reference data, H/V input, reference SPL/distance, drag (8/9 to 6/9), yaw (0/9), pitch (1/9), wider dispersion (9/9), and length change 7 to 9 m (11 seats). The SPL field and seat values updated, and no browser console errors were reported.
