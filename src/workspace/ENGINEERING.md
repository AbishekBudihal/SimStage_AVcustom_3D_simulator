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
{
  "nodes": [
    { "id": "display", "catalogId": "samsung-qm75b" },
    { "id": "camera", "catalogId": "yealink-uvc86" }
  ],
  "connections": [
    {
      "from": { "deviceId": "camera", "portId": "hdmi-out" },
      "to": { "deviceId": "display", "portId": "hdmi-1" }
    }
  ]
}
```

Optional node `position` and `rotation` use XYZ objects in metres and radians and preserve explicit engineer transforms. Arbitrary schematic drawing/PDF formats are not parsed. This path uses the active DeviceStore; no AppState synchronization layer or second persistent model exists. Rack-unit metadata and straight-line cable estimates remain available; rack allocation and installation cable routing have not been added.

The procedural room includes a downward-facing ceiling (open from above), dimension-driven ceiling lights, floor seams, furniture groups and demand-rendered shadows. No static room model is loaded. There is no full collision solver or guarantee that equipment footprints cannot overlap.

## Procedural room and verification — September 2026

The active room uses Three.js meshes throughout: rounded furniture, generated wood/fabric material maps, window frames, low wall wainscot, a seamless studio ground and a downward-facing ceiling/light strips. ACES tone mapping, hemisphere fill and a directional key create demand-rendered contact shadows; the 2048 px shadow camera tracks room size. These visual lighting/material choices are not photometric or acoustic material simulations. Generated textures, geometries and materials are disposed on room replacement/unmount.

Automatic wall placement searches free horizontal anchors around displays; table devices search free 0.5 m anchors inside the tabletop where space permits. Manual transforms remain unchanged. This is simple envelope spacing, not a full collision or clearance solver; crowded scenes still require review.

Validation: 121/121 active workspace Vitest cases passed and production build succeeded. Coverage instrumentation was not run. The existing large bundle warning remains; 60 FPS was not benchmarked. Browser verification included microphone addition, pickup radius/angle edits, yaw, drag (9 to 5 covered seats), adding another microphone (room coverage restored to 9/9), and overlay orbit alignment. Speaker verification covered missing reference data, H/V input, reference SPL/distance, drag (8/9 to 6/9), yaw (0/9), pitch (1/9), wider dispersion (9/9), and length change 7 to 9 m (11 seats). The SPL field and seat values updated, and no browser console errors were reported.

## Custom tables

Room parameters now include optional table width, length, height, oak/walnut/white finish and rounded/square edges. These parameters generate our own Three.js furniture, with no Google geometry involved. The same immutable room state drives furniture, seating, automatic table anchors and analysis. Dimensions are clamped to the available room clearance; the UI shows effective dimensions. Custom training desks determine bay spacing and seats per desk. Manual equipment remains unchanged. Disabling customization restores automatic table dimensions.

Validation: 126/126 active workspace tests passed; production build passed (existing bundle-size warning). Browser checks verified 2.2 x 4.5 x 0.9 m walnut/square furniture, 12 generated seats, recalculated audio summaries and reset to the original 9-seat layout. No console errors were reported.

Google Photorealistic 3D Tiles integration is not implemented in this milestone. Site location and an enabled Map Tiles API project are still required. Google tiles would be exterior visualization context with required attribution; editable architectural geometry must remain independently authored, not extracted or traced from those tiles. See https://developers.google.com/maps/documentation/tile/policies .

## Direct furniture editing

`Edit furniture` enables raycast selection and dragging of generated tables and chairs. The inspector edits each table's dimensions and each chair's orientation. Dragging uses a 0.25 m grid (Shift: 0.05 m); Escape, pointer cancellation and window blur roll back the current gesture. Room changes during a gesture invalidate its rollback.

Authored furniture overrides live in `DeviceStore.room.furniture`. `roomLayout` applies the same coordinates to Three.js furniture, listening/viewing seats and automatic tabletop equipment. Unedited seats follow their nearest generated table; explicitly positioned chairs and manually placed equipment remain independent. Resizing a table scales its generated seating offsets. Room bounds clamp the effective furniture footprint without discarding authored coordinates. Changing room type, layout or capacity clears overrides because the generated object identities change; presets also reset them. Per-object and full-layout reset controls are provided.

Furniture-only changes reuse meshes and geometry, retain the camera, and schedule demand-rendered frames. They do not rebuild architectural surfaces or textures. Table meshes scale from their generated dimensions. Overlap prevention, arbitrary table rotation, wall topology editing and installation clearance certification are not implemented. Furniture is not an equipment BOM item. Session data remains in memory.

## Scenario stress tests and layered analysis

The active `DeviceStore.scenario` holds a reproducible seed, trial count (10–5000), occupancy percentage range, background noise range, full-occupancy noise rise, RT60 range, speech level, acceptance percentage, speech-proxy threshold, additional Dante flow range and a shared bottleneck link budget. `ScenarioSimulation` is pure; `scenario.worker.ts` runs sampling off the UI thread. Live tests debounce edits, terminate superseded workers and hide stale results immediately. Stop/pause prevents further runs; results are always tied to their input references.

Each trial samples uniform independent ranges and chooses existing seat positions without replacement. Occupancy contributes to noise through `10 log10(1 + occupancyFraction * (10^(fullOccupancyRise/10) - 1))`. This is a user-controlled scenario assumption, not a crowd acoustic model. Microphone paths use current pickup geometry and free-field speech attenuation (reference distance clamped at 1 m). The best known covered microphone is evaluated per occupied seat; the worst occupied seat governs a trial. The existing broadband modulation-transfer proxy applies noise and RT60. It excludes octave-band weighting, masking, microphone noise, beamforming processing, echoes and certified STI. Missing inputs produce UNVERIFIED; definite geometric or budget failures can still produce FAIL. A disconnected required physical port blocks the joint policy. PASS means only the configured sampled policy passed; it is not a deployment guarantee. Trials report acoustic/network pass rates, joint pass rate, unknown count, minimum computed speech proxy, worst sampled case and P95 traffic. The percentages are empirical results under assumed distributions, not confidence guarantees.

Signal audit uses the active schematic connections. Dante labels/protocols establish an unknown subscription until channel count, sample rate and unicast receiver count are explicitly declared. Engineers may also declare Dante traffic on Ethernet connections; this declaration does not certify endpoint protocol compatibility. The budget estimates `ceil(channels / 4) * 6 Mb/s * (sampleRate / 48000) * receivers`; additional scenario flows use the 48 kHz budget. Source: [Audinate, Designing Dante Networks at Scale](https://support.getdante.com/hc/en-gb/articles/6025914793119-Designing-Dante-Networks-at-Scale), which describes approximately 6 Mb/s per unicast flow carrying up to four channels. 96 kHz is a scaled planning estimate. All declared flows are assumed to share the configured bottleneck; multicast, per-switch routing, DSP internal paths, QoS, jitter, latency, PTP, link redundancy and device flow ceilings are not simulated. [NTi Audio's STI measurement guidance](https://www.nti-audio.com/en/support/know-how/basics-of-sti-measurement) explains why noise and reverberation alone do not establish measured system STI.

Floor layers independently select SPL, microphone coverage or viewing planning, with an optional layer showing all cameras with supplied HFOV/VFOV. Floor fields sample the shared listening plane; camera volumes clip to the room shell. Green/amber/red/grey viewing cells use the existing public BDM/4-6-8/project off-axis evaluator, not a licensed complete DISCAS conformance engine. Furniture occlusion, reflection, diffraction and material transmission loss are not modeled. Heatmap geometry is reused; camera overlay resources are disposed when disabled or removed.

## Portable catalog database v2

Catalog import accepts the original array or `{schemaVersion:2, units:{dimensions:"m",weight:"kg",power:"W",heat:"BTU/h"}, parts:[...]}`. The optional units declaration is checked. Each immutable profile retains its revision, source, provenance, original record, exact supplied dimensions/connector descriptions and optional weight, electrical and thermal fields. Existing IDs cannot be overwritten: import a new ID for a revision so placed specifications remain reproducible. Catalog export preserves raw records and supports subsequent reimport into a fresh session. This is a local portable catalog, not a hosted multi-user database.

`physical.weightKg` from the actual uploaded files now propagates to device metadata and BOM aggregation. Missing weight/power/heat remain unknown; supplied estimates remain labeled estimates. Custom product entry exposes these fields and revision. No unspecified manufacturer specification is filled with fabricated exact values. Physical port definitions continue to populate live schematic nodes immediately when equipment is added.

Validation for scenario/catalog/layer milestone: 153/153 active workspace tests passed; strict TypeScript and production build passed (existing main-bundle size warning remains). Production-preview browser checks exercised the worker, changing RT60/noise/link settings, independent SPL and viewing layers, a camera with supplied HFOV/VFOV, a real catalog MXA710W-to-P300 Ethernet connection with an explicit 8-channel Dante declaration (12 Mb/s), live Monte Carlo budget updates and known/unknown BOM weights. No browser console errors were observed. Coverage instrumentation and frame-rate benchmarking were not performed.

## User-authored speaker pressure maps

Select **Floor analysis layer → Speaker pressure map**. Enter sensitivity (dB SPL at 1 W / 1 m), total drive watts, horizontal/vertical -6 dB angles, optional phase/delay, and optional ascending frequency-response rows. Custom catalog products also accept sensitivity, drive power and response rows; portable catalog export preserves those inputs. Placed-speaker overrides remain separate from catalog definitions.

PressureModel computes 1/12-octave bands in a cancellable Web Worker. Pink noise uses equal energy per logarithmic bandwidth; speech uses a generic 1 kHz-centred shaping curve, not an IEC test signal. Band weights sum to total drive power. Response rows interpolate in log frequency without extrapolation. Missing inputs remain unknown. Without rows, constant sensitivity/dispersion is an explicit assumption. Parametric angular attenuation is 6 times the larger squared normalized horizontal/vertical angle, capped at 60 dB. Distance spreading clamps below 1 m.

Noise sums incoherent energies. Sine sums complex pressures with authored phase, delay, and path delay at 343 m/s. Optional first-order image sources model six rectangular boundaries with one uniform absorption coefficient. Table slabs and rotated rack bounding boxes cast geometric shadows. Surfaces include a configurable/raked audience plane or floor and tabletops. GPU textures store computed dB samples and validity masks; bilinear display shading does not increase calculation resolution. Fine sine interference may be undersampled and produces a warning.

This is an estimated planning model, not measured polar data, certified STI, or a full wave solver. No diffraction, late reverberation, air absorption, room modes, crowd scattering, measured reflection phase or nonlinear compression is modeled. A closed acoustic shell is assumed even though the rendered room is cut away. Room/device/settings edits cancel stale calculations; meshes and textures are reused and disposed on teardown.

## Calibrated environment importing

`EnvironmentImporter` previews PNG/JPG raster plans and ASCII DXF model-space closed, straight LWPOLYLINE footprints. Raster plans require manual tracing; there is no inferred wall recognition. Unsupported DXF entities are reported. Native DWG is not decoded: export ASCII DXF from the originating CAD tool. DXF implementation follows Autodesk's LWPOLYLINE group-code reference (10/20 coordinates, 70 closed flag, 42 bulge); curves and non-default extrusion directions are rejected rather than silently flattened.

Two clicked endpoints and a known distance define metres per source unit; nearby DXF vertices snap for calibration. Source geometry is centred on the room in X/Z. Walls, ceilings and audience blocks are simple closed footprints with base elevation and extrusion height. Three.js triangulates concave footprints; self-intersections, degenerate polygons, duplicate IDs and excessive geometry are rejected. Limits: 10 MB input, 200 outlines, 2,000 vertices per outline / 10,000 total, 500 m extent; images also have 8192 px per-side / 24 MP limits. Outlines have no holes; nested polygons remain separate solids.

The single `DeviceStore.environment` owns immutable import data. Apply preserves equipment and connections; Fit room & apply uses existing room updates (3–30 m per side), including automatic equipment placement and furniture regeneration. Existing manually placed equipment follows the existing room-resize clamping policy. Imported geometry keeps its own calibrated size as room dimensions change. All imports are session-local. The procedural shell and furniture remain available alongside imported meshes.

Pressure calculations send geometry without raster bytes to the worker. Exact triangle intersection adds imported mesh shadows to direct and first-order reflection path checks. Reflections still use the rectangular shell. Quick acoustic/optical coverage and the health score do not yet use these obstruction meshes. Audience blocks are geometry, not automatic listener-seat arrays; device mounting and cable routing still use the active parametric room surfaces. Arbitrary 3D model-file ingestion is not included.

Validation: 176 active workspace tests pass, TypeScript/production build pass. Browser checks cover DXF loading, two-point calibration, changing a footprint to an audience block and fitting/applying to the live scene, plus PNG calibration, tracing and applying a wall. Imported obstruction counts update in the pressure-map result. Existing Vite main-chunk size warning remains; no blanket frame-rate guarantee is asserted.

## Blueprint editing, topology and export (October 2026)

The manual path now includes local PDF.js page rasterization, PNG/JPG/DXF ingestion, a blank calibrated plan, 2D pan/zoom, endpoint-first snapping and a metre-based grid. PDF page number is chosen before importing; scans are traced manually. Native DWG conversion, image preprocessing, automatic wall/symbol recognition, arbitrary CAD curves and FBX export are not implemented.

Wall centerlines carry source-coordinate endpoints, metre thickness, height/elevation, material, and rectangular door/window openings. The graph planarizes crossings and T-junctions, deduplicates coincident edges and walks bounded faces; dangling branches are excluded from face traversal. Generated floor/ceiling polygons inset to inner wall edges. Nested loops and holes still require review; offsets that produce invalid polygons are rejected. Generated slabs recompute during validation while `zoneCeilingHeight` is enabled. Editing/deleting a generated slab through the geometry inspector detaches automatic slab generation.

Openings use disjoint rectangular wall panels around each aperture, avoiding general CSG numerical tolerances. Overlapping openings or openings outside wall dimensions are rejected. Normal/UV attributes come from Three.js box/extrusion geometry. The same generated triangles feed the pressure obstruction engine; openings transmit geometric rays. This adds no diffraction or late-reverberation model.

A demand-rendered Three.js preview sits beside the blueprint and supports orbit/pan/zoom and click-to-inspect. The inspector edits wall endpoints, thickness, height, elevation, materials and apertures; arbitrary footprints expose vertex coordinates. Existing main-workspace cameras and equipment/schematic/BOM architecture are retained. Apply is an explicit commit of the draft into DeviceStore; closing the editor discards unapplied draft changes when next opened.

Versioned blueprint JSON saves source image, calibrated outlines and architectural metadata; it does not serialize the entire AV equipment project. Re-import validates before replacing the draft. GLB exports geometry and basic materials; OBJ exports geometry/normals/UVs without a material library. Both exclude the raster underlay and AV equipment. PDF and exporters load on demand. Main bundle-size warning remains.

Browser verification covered four-wall drawing, bounded room generation, live height editing, a window opening, PDF rasterization, and exported GLB/JSON contents. Unit tests cover topology, snapping, invalid openings, acoustic passage through an aperture, inner offsets, derived-slab regeneration, serialization and OBJ geometry.

Final integration verification: 187/187 active workspace tests pass. The store-to-CanvasManager integration test verifies geometry replacement/disposal and acoustic blockers while preserving AV devices, connections and BOM totals. Browser apply/reopen and signal-tab checks preserved all five devices and the existing connection, with no captured console errors. Selection highlighting does not rebuild preview geometry.
