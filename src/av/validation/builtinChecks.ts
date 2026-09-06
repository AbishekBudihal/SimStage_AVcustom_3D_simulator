/**
 * builtinChecks.ts
 * Real checks only. Each finding is derived from an existing engine
 * (ViewingDistanceEngine, SightlineEngine, RoomGeometry, SnapEngine,
 * MicrophoneCoverageEngine, SpeakerCoverageEngine, CameraCoverageEngine).
 */

import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationCheck, ValidationFinding } from './ValidationTypes';
import { getPresentationWall, worldToWallOffset } from '../../room/RoomGeometry';
import { displayOverlapsOpening } from '../../interaction/SnapEngine';
import type { SeatDisplayAnalysis } from '../ViewingDistanceEngine';
import {
  modelLabel,
  resolveProjectMicrophones,
  summarizeMicCoverage,
  usableMicPlacements
} from '../MicAnalysis';
import { AUDIO_METHOD, SPL_TARGET_MIN, SPL_TARGET_MAX } from '../SpeakerCoverageEngine';
import { resolveProjectSpeakers, summarizeSpeakerCoverage } from '../SpeakerAnalysis';
import { CAMERA_METHOD } from '../CameraCoverageEngine';
import { resolveProjectCameras, summarizeCameraCoverage } from '../CameraAnalysis';
import { FURNITURE_CHECKS } from './furnitureChecks';
import { EQUIPMENT_CHECKS } from './equipmentChecks';

function finding(
  partial: Omit<ValidationFinding, 'affectedObjects' | 'recommendedActions' | 'potentialVariables'> & {
    affectedObjects?: ValidationFinding['affectedObjects'];
    recommendedActions?: string[];
    potentialVariables?: string[];
  }
): ValidationFinding {
  return {
    affectedObjects: [],
    recommendedActions: [],
    potentialVariables: [],
    ...partial
  };
}

function seatsFor(
  analyses: SeatDisplayAnalysis[],
  pred: (a: SeatDisplayAnalysis) => boolean
): ValidationFinding['affectedObjects'] {
  return analyses.filter(pred).map((a) => ({ kind: 'seat' as const, id: a.seatId, label: `Seat ${a.seatId}` }));
}

export const checkDisplayData: ValidationCheck = {
  code: 'DISPLAY-001',
  category: 'display',
  title: 'Display data',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (ctx.display.kind === 'none') {
      return [
        finding({
          id: 'DISPLAY-001',
          code: 'DISPLAY-001',
          severity: 'error',
          category: 'display',
          title: 'No display in the design',
          message: 'Viewing validation cannot run until a display is placed.',
          explanation: 'There is no equipment instance with category "display" in the project.',
          objectId: undefined,
          recommendedActions: ['Add a display from the equipment catalog and accept a suggested wall placement.'],
          potentialVariables: ['Display product', 'Display placement'],
          source: 'Equipment catalog lookup — no values invented.'
        })
      ];
    }
    if (ctx.display.kind === 'incomplete') {
      return [
        finding({
          id: 'DISPLAY-001',
          code: 'DISPLAY-001',
          severity: 'warning',
          category: 'display',
          title: 'Display data incomplete',
          message: ctx.display.reason,
          explanation: 'Physical width, height, or screen-size data is missing. Viewing-distance heuristics need image height.',
          objectId: ctx.display.instance.instanceId,
          affectedObjects: [
            { kind: 'equipment', id: ctx.display.instance.instanceId, label: ctx.display.product.model }
          ],
          recommendedActions: ['Supply manufacturer physical dimensions for this product before using viewing results for sign-off.'],
          potentialVariables: ['Display catalog data'],
          source: 'EquipmentProduct.physical / display spec presence check.'
        })
      ];
    }
    const p = ctx.display.product;
    return [
      finding({
        id: 'DISPLAY-001',
        code: 'DISPLAY-001',
        severity: 'pass',
        category: 'display',
        title: 'Display data',
        message: `${p.manufacturer} ${p.model} has physical size ${p.physical.width} × ${p.physical.height} m and ${p.display?.diagonalInches}" diagonal.`,
        explanation: 'Required fields for viewing analysis are present. Provenance remains whatever the catalog records (often estimated).',
        objectId: ctx.display.instance.instanceId,
        affectedObjects: [{ kind: 'equipment', id: ctx.display.instance.instanceId, label: p.model }],
        source: 'Equipment catalog.'
      })
    ];
  }
};

export const checkDisplayOpenings: ValidationCheck = {
  code: 'DISPLAY-002',
  category: 'display',
  title: 'Display vs door/window',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (ctx.display.kind !== 'ok' || !ctx.room) return [];
    const inst = ctx.display.instance;
    const wall = inst.wall ?? ctx.display.placement.wall;
    const offset = worldToWallOffset(ctx.room, wall, inst.position.x, inst.position.z);
    const overlaps = displayOverlapsOpening(ctx.room, wall, offset, ctx.display.product.physical.width);
    if (overlaps) {
      return [
        finding({
          id: 'DISPLAY-002',
          code: 'DISPLAY-002',
          severity: 'error',
          category: 'display',
          title: 'Display overlaps a door or window exclusion zone',
          message: `The display footprint on the ${wall} wall intersects a door/window exclusion zone.`,
          explanation: 'The same exclusion geometry used by placement suggestion and snapping forbids mounting on openings.',
          objectId: inst.instanceId,
          affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: ctx.display.product.model }],
          recommendedActions: ['Snap the display to a valid wall surface', 'Choose a different presentation wall'],
          potentialVariables: ['Display position', 'Presentation wall'],
          source: 'SnapEngine.displayOverlapsOpening / RoomGeometry wall candidates.'
        })
      ];
    }
    return [
      finding({
        id: 'DISPLAY-002',
        code: 'DISPLAY-002',
        severity: 'pass',
        category: 'display',
        title: 'Display placement',
        message: `Display is clear of door/window exclusion zones on the ${wall} wall.`,
        explanation: 'Footprint checked against padded opening spans on the mounted wall.',
        objectId: inst.instanceId,
        affectedObjects: [{ kind: 'equipment', id: inst.instanceId, label: ctx.display.product.model }],
        source: 'SnapEngine.displayOverlapsOpening.'
      })
    ];
  }
};

export const checkPresentationWall: ValidationCheck = {
  code: 'DISPLAY-003',
  category: 'display',
  title: 'Presentation wall',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (ctx.display.kind !== 'ok' || !ctx.room) return [];
    const intended = getPresentationWall(ctx.room);
    const actual = ctx.display.instance.wall ?? ctx.display.placement.wall;
    if (actual !== intended) {
      return [
        finding({
          id: 'DISPLAY-003',
          code: 'DISPLAY-003',
          severity: 'info',
          category: 'display',
          title: 'Display is not on the room presentation wall',
          message: `Display is on the ${actual} wall; the room presentation wall is ${intended}.`,
          explanation: 'Seating is oriented toward the presentation wall. A display on another wall may still be valid but viewing angles for generated seats will suffer.',
          objectId: ctx.display.instance.instanceId,
          affectedObjects: [{ kind: 'equipment', id: ctx.display.instance.instanceId, label: ctx.display.product.model }],
          recommendedActions: ['Move the display to the presentation wall', 'Or change the room presentation-wall override'],
          potentialVariables: ['Display wall', 'Room presentationWall'],
          source: 'RoomGeometry.getPresentationWall vs equipment.wall.'
        })
      ];
    }
    return [
      finding({
        id: 'DISPLAY-003',
        code: 'DISPLAY-003',
        severity: 'pass',
        category: 'display',
        title: 'Presentation wall',
        message: `Display is mounted on the ${actual} presentation wall.`,
        explanation: 'Matches getPresentationWall (explicit override or automatic selection).',
        objectId: ctx.display.instance.instanceId,
        source: 'RoomGeometry.getPresentationWall.'
      })
    ];
  }
};

function viewingCheck(
  code: string,
  title: string,
  pick: (a: SeatDisplayAnalysis) => { status: 'pass' | 'warning' | 'fail'; value: string; expected: string; method: string },
  errorTitle: string,
  warningTitle: string,
  actions: string[],
  variables: string[]
): ValidationCheck {
  return {
    code,
    category: 'viewing',
    title,
    evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
      if (ctx.display.kind !== 'ok' || ctx.seats.length === 0) return [];
      const failed = ctx.seatAnalyses.filter((a) => pick(a).status === 'fail');
      const warned = ctx.seatAnalyses.filter((a) => pick(a).status === 'warning');
      if (failed.length) {
        const sample = pick(failed[0]);
        return [
          finding({
            id: code,
            code,
            severity: 'error',
            category: 'viewing',
            title: errorTitle,
            message: `${failed.length} of ${ctx.seatAnalyses.length} seats are outside this check.`,
            explanation: sample.method,
            metric: { name: title, actual: sample.value, expected: sample.expected },
            objectId: ctx.display.instance.instanceId,
            affectedObjects: seatsFor(failed, () => true),
            recommendedActions: actions,
            potentialVariables: variables,
            source: sample.method
          })
        ];
      }
      if (warned.length) {
        const sample = pick(warned[0]);
        return [
          finding({
            id: code,
            code,
            severity: 'warning',
            category: 'viewing',
            title: warningTitle,
            message: `${warned.length} of ${ctx.seatAnalyses.length} seats are marginal on this check.`,
            explanation: sample.method,
            metric: { name: title, actual: sample.value, expected: sample.expected },
            objectId: ctx.display.instance.instanceId,
            affectedObjects: seatsFor(warned, () => true),
            recommendedActions: actions,
            potentialVariables: variables,
            source: sample.method
          })
        ];
      }
      const sample = pick(ctx.seatAnalyses[0]);
      return [
        finding({
          id: code,
          code,
          severity: 'pass',
          category: 'viewing',
          title,
          message: `All ${ctx.seatAnalyses.length} seats satisfy this check.`,
          explanation: sample.method,
          metric: { name: title, actual: sample.value, expected: sample.expected },
          source: sample.method
        })
      ];
    }
  };
}

export const checkViewingDistance = viewingCheck(
  'VIEW-001',
  'Viewing distance',
  (a) => ({
    status: a.viewingDistance.status,
    value: `${a.viewingDistance.value} ${a.viewingDistance.unit}`,
    expected: a.viewingDistance.threshold
      ? `${a.viewingDistance.threshold.min ?? '—'}–${a.viewingDistance.threshold.max ?? '—'} m`
      : 'see method',
    method: a.viewingDistance.method
  }),
  'Display viewing distance',
  'Display viewing distance (marginal)',
  ['Increase display size', 'Move seating closer to the display', 'Move the display toward the seating'],
  ['Display size', 'Display position', 'Seating layout']
);

export const checkHorizontalAngle = viewingCheck(
  'VIEW-002',
  'Horizontal viewing angle',
  (a) => ({
    status: a.horizontalAngle.status,
    value: `${a.horizontalAngle.value}°`,
    expected: `pass ≤30°, warning 30–45°, fail >45°`,
    method: a.horizontalAngle.method
  }),
  'Horizontal viewing angle',
  'Horizontal viewing angle (marginal)',
  ['Re-center the display on the seating cluster', 'Reconfigure seating toward the display'],
  ['Display position', 'Seating layout']
);

export const checkVerticalAngle = viewingCheck(
  'VIEW-003',
  'Vertical viewing angle',
  (a) => ({
    status: a.verticalAngle.status,
    value: `${a.verticalAngle.value}°`,
    expected: `pass ≤15°, warning 15–30°, fail >30°`,
    method: a.verticalAngle.method
  }),
  'Vertical viewing angle',
  'Vertical viewing angle (marginal)',
  ['Lower the display mount height', 'Increase viewing distance'],
  ['Display mount height', 'Seating position']
);

export const checkVisibility = viewingCheck(
  'VIEW-004',
  'Display visibility',
  (a) => ({
    status: a.visibility.status,
    value: a.visibility.value,
    expected: 'visible (in front of the display face)',
    method: a.visibility.method
  }),
  'Display not visible',
  'Display visibility (marginal)',
  ['Move seats in front of the display', 'Rotate or re-wall-mount the display'],
  ['Display orientation', 'Seating layout']
);

export const checkSightline: ValidationCheck = {
  code: 'VIEW-005',
  category: 'viewing',
  title: 'Sightline obstruction',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (ctx.display.kind !== 'ok' || ctx.seats.length === 0) return [];
    const blocked = ctx.seatAnalyses.filter((a) => a.sightline.status === 'fail');
    if (blocked.length) {
      const blockers = ctx.obstacles
        .filter((o) => o.id.startsWith('table:'))
        .map((o) => o.id.replace('table:', ''));
      const tables = ctx.tables.filter((t) => blockers.includes(t.id));
      return [
        finding({
          id: 'VIEW-005',
          code: 'VIEW-005',
          severity: 'error',
          category: 'viewing',
          title: 'Display sightline obstruction',
          message: `${blocked.length} seat(s) have a blocked line of sight to the display.`,
          explanation: blocked[0].sightline.method,
          metric: { name: 'Sightline', actual: 'blocked', expected: 'clear' },
          objectId: ctx.display.instance.instanceId,
          affectedObjects: [
            ...seatsFor(blocked, () => true),
            ...tables.map((t) => ({ kind: 'table' as const, id: t.id, label: t.id }))
          ],
          recommendedActions: [
            'Raise the display',
            'Move the blocking furniture',
            'Reposition the affected seats'
          ],
          potentialVariables: ['Display height', 'Table position', 'Seat position'],
          source: blocked[0].sightline.method
        })
      ];
    }
    return [
      finding({
        id: 'VIEW-005',
        code: 'VIEW-005',
        severity: 'pass',
        category: 'viewing',
        title: 'Sightline obstruction',
        message: `No registered obstacle (tables, columns) intersects seat-to-display rays. Occupant bodies and glazing are not modeled.`,
        explanation: ctx.seatAnalyses[0]?.sightline.method ?? '',
        source: 'SightlineEngine vs ObstacleBuilder (tables + columns).'
      })
    ];
  }
};

export const checkSeatingPresent: ValidationCheck = {
  code: 'SEAT-001',
  category: 'seating',
  title: 'Seating',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (ctx.seats.length === 0) {
      return [
        finding({
          id: 'SEAT-001',
          code: 'SEAT-001',
          severity: 'warning',
          category: 'seating',
          title: 'No seating generated',
          message: 'Viewing checks need at least one seat.',
          explanation: 'Generate a seating layout before treating viewing coverage as complete.',
          recommendedActions: ['Generate seating in the Seating step'],
          potentialVariables: ['Seating layout', 'Capacity'],
          source: 'AppState.seats length.'
        })
      ];
    }
    return [
      finding({
        id: 'SEAT-001',
        code: 'SEAT-001',
        severity: 'pass',
        category: 'seating',
        title: 'Seating',
        message: `${ctx.seats.length} seats in the design.`,
        explanation: 'Seats are generator-owned entities, not inferred from furniture.',
        source: 'AppState.seats.'
      })
    ];
  }
};

export const checkWallClearance: ValidationCheck = {
  code: 'SEAT-002',
  category: 'seating',
  title: 'Wall clearance',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.room || ctx.seats.length === 0) return [];
    const hw = ctx.room.width / 2;
    const hd = ctx.room.depth / 2;
    const clearance = 0.3;
    const tight = ctx.seats.filter(
      (s) =>
        Math.abs(s.x) > hw - clearance ||
        Math.abs(s.z) > hd - clearance
    );
    if (tight.length) {
      return [
        finding({
          id: 'SEAT-002',
          code: 'SEAT-002',
          severity: 'warning',
          category: 'seating',
          title: 'Seats close to a wall',
          message: `${tight.length} seat(s) are within ${clearance} m of a wall.`,
          explanation: 'Clearance is a geometric bound check against room half-width/depth, not a circulation-code calculation.',
          affectedObjects: tight.map((s) => ({ kind: 'seat' as const, id: s.id, label: `Seat ${s.id}` })),
          recommendedActions: ['Regenerate seating with more side/rear clearance', 'Move the affected seats inward'],
          potentialVariables: ['Seating clearance', 'Seat position'],
          source: 'Seat x/z vs room bounds.'
        })
      ];
    }
    return [
      finding({
        id: 'SEAT-002',
        code: 'SEAT-002',
        severity: 'pass',
        category: 'seating',
        title: 'Wall clearance',
        message: `All seats are at least ${clearance} m from room walls.`,
        explanation: 'Geometric bound check only.',
        source: 'Seat x/z vs room bounds.'
      })
    ];
  }
};

export const checkMicPickupData: ValidationCheck = {
  code: 'MIC-002',
  category: 'microphone',
  title: 'Microphone pickup data',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectMicrophones(ctx.equipment, ctx.catalog);
    if (resolved.length === 0) return [];
    const incomplete = resolved.filter((m) => m.incompleteKind === 'radius');
    if (incomplete.length) {
      return [
        finding({
          id: 'MIC-002',
          code: 'MIC-002',
          severity: 'warning',
          category: 'microphone',
          title: 'Microphone pickup data incomplete',
          message: `${incomplete.length} of ${resolved.length} microphone(s) have no usable catalog pickupRadiusM.`,
          explanation:
            'Coverage is only calculated for units with a positive pickupRadiusM. Missing radii are not invented.',
          metric: { name: 'Pickup radius', actual: 'DATA INCOMPLETE', expected: 'Catalog pickupRadiusM > 0' },
          affectedObjects: incomplete.map((m) => ({
            kind: 'equipment' as const,
            id: m.instanceId,
            label: m.name
          })),
          recommendedActions: ['Supply a datasheet pickup radius for the product', 'Replace with a catalog microphone that includes pickupRadiusM'],
          potentialVariables: ['Microphone model', 'Pickup radius'],
          source: 'EquipmentCatalog.microphone.pickupRadiusM'
        })
      ];
    }
    const usable = resolved.filter((m) => !m.incomplete);
    if (usable.length === 0) return [];
    return [
      finding({
        id: 'MIC-002',
        code: 'MIC-002',
        severity: 'pass',
        category: 'microphone',
        title: 'Microphone pickup data',
        message: `${usable.length} microphone(s) have catalog data for the selected coverage model.`,
        explanation: usable.map((m) => `${m.name}: ${modelLabel(m.coverageModel)}`).join(' '),
        source: 'EquipmentCatalog.microphone'
      })
    ];
  }
};

export const checkMicDirectionalData: ValidationCheck = {
  code: 'MIC-003',
  category: 'microphone',
  title: 'Microphone directional data',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectMicrophones(ctx.equipment, ctx.catalog);
    const incomplete = resolved.filter((m) => m.incompleteKind === 'directional');
    if (incomplete.length === 0) return [];
    return [
      finding({
        id: 'MIC-003',
        code: 'MIC-003',
        severity: 'warning',
        category: 'microphone',
        title: 'Directional pickup data incomplete',
        message: `${incomplete.length} microphone(s) request a directional sector but have no usable catalog beamWidthDeg.`,
        explanation:
          'DATA INCOMPLETE — a directional pattern is not assumed. Disc fallback is not used when directional data was requested but missing.',
        metric: { name: 'Beam width', actual: 'DATA INCOMPLETE', expected: 'Catalog beamWidthDeg > 0' },
        affectedObjects: incomplete.map((m) => ({
          kind: 'equipment' as const,
          id: m.instanceId,
          label: m.name
        })),
        recommendedActions: ['Enter a datasheet beam width', 'Set coverageModel to omni if only a pickup radius is known'],
        potentialVariables: ['beamWidthDeg', 'coverageModel'],
        source: 'EquipmentCatalog.microphone.beamWidthDeg'
      })
    ];
  }
};

export const checkMicCoverageGap: ValidationCheck = {
  code: 'MIC-001',
  category: 'microphone',
  title: 'Microphone coverage',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectMicrophones(ctx.equipment, ctx.catalog);
    const mics = usableMicPlacements(resolved);
    if (mics.length === 0 || ctx.seats.length === 0) return [];

    const summary = summarizeMicCoverage(ctx.seats, ctx.equipment, ctx.catalog);
    const uncovered = summary.seatResults.filter((r) => !r.covered);
    if (uncovered.length === 0) {
      return [
        finding({
          id: 'MIC-001',
          code: 'MIC-001',
          severity: 'pass',
          category: 'microphone',
          title: 'Microphone coverage',
          message: `All ${summary.totalSeats} seat(s) lie inside at least one calculated pickup region.`,
          explanation: summary.methodology,
          metric: {
            name: 'Seats inside pickup region',
            actual: String(summary.coveredSeats),
            expected: String(summary.totalSeats)
          },
          source: summary.methodology
        })
      ];
    }

    const sample = uncovered[0];
    return [
      finding({
        id: 'MIC-001',
        code: 'MIC-001',
        severity: 'error',
        category: 'microphone',
        title: 'Microphone coverage gap',
        message: `${uncovered.length} seat(s) are outside the microphone's calculated pickup region.`,
        explanation: `${summary.methodology} Uncovered seat criterion: ${sample.criterion}. Model: ${modelLabel(sample.coveringModel ?? undefined)}.`,
        metric: {
          name: sample.coveringModel === 'directional_sector' ? 'Distance / azimuth to nearest mic' : 'Nearest mic distance',
          actual:
            sample.coveringModel === 'directional_sector'
              ? `${sample.nearestDistanceM ?? 'n/a'} m, ${sample.angularDeltaDeg ?? 'n/a'}°`
              : sample.nearestDistanceM != null
                ? `${sample.nearestDistanceM} m`
                : 'n/a',
          expected: sample.criterion,
          unit: sample.coveringModel === 'directional_sector' ? 'm / deg' : 'm'
        },
        objectId: sample.nearestMicId ?? undefined,
        affectedObjects: [
          ...uncovered.map((r) => ({ kind: 'seat' as const, id: r.seatId, label: `Seat ${r.seatId}` })),
          ...resolved
            .filter((m) => !m.incomplete)
            .map((m) => ({ kind: 'equipment' as const, id: m.instanceId, label: m.name }))
        ],
        recommendedActions: [
          'Move or rotate the microphone so the calculated region covers the seats',
          'Add another microphone whose pickup region reaches those seats',
          'Use catalog data with a documented radius and, if directional, beam width'
        ],
        potentialVariables: ['Microphone position', 'Microphone rotation', 'Microphone count', 'Catalog pickupRadiusM / beamWidthDeg'],
        source: summary.methodology
      })
    ];
  }
};

export const checkSpeakerData: ValidationCheck = {
  code: 'AUDIO-003',
  category: 'audio',
  title: 'Speaker data',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectSpeakers(ctx.equipment, ctx.catalog);
    if (resolved.length === 0) return [];
    const incomplete = resolved.filter((s) => s.incomplete);
    if (incomplete.length) {
      return [
        finding({
          id: 'AUDIO-003',
          code: 'AUDIO-003',
          severity: 'warning',
          category: 'audio',
          title: 'Speaker data incomplete',
          message: `${incomplete.length} of ${resolved.length} speaker(s) cannot be evaluated.`,
          explanation: incomplete.map((s) => s.incompleteReason ?? 'DATA INCOMPLETE').join(' '),
          metric: { name: 'Speaker catalog data', actual: 'DATA INCOMPLETE', expected: 'maxSplAt1m and dispersion' },
          affectedObjects: incomplete.map((s) => ({ kind: 'equipment' as const, id: s.instanceId, label: s.name })),
          recommendedActions: ['Supply datasheet max SPL @ 1 m and dispersion', 'Do not assume 100 dB or 90°'],
          potentialVariables: ['maxSplAt1m', 'dispersionDeg'],
          source: 'EquipmentCatalog.speaker'
        })
      ];
    }
    return [
      finding({
        id: 'AUDIO-003',
        code: 'AUDIO-003',
        severity: 'pass',
        category: 'audio',
        title: 'Speaker data',
        message: `${resolved.length} speaker(s) have catalog SPL and dispersion for the free-field estimate.`,
        explanation: AUDIO_METHOD,
        source: 'EquipmentCatalog.speaker'
      })
    ];
  }
};

export const checkSpeakerSplThreshold: ValidationCheck = {
  code: 'AUDIO-001',
  category: 'audio',
  title: 'Speaker SPL threshold',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectSpeakers(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((s) => !s.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeSpeakerCoverage(ctx.seats, ctx.equipment, ctx.catalog);
    const below = summary.seatResults.filter((r) => r.inDispersion && r.splAtSeat != null && r.splAtSeat < SPL_TARGET_MIN);
    if (below.length === 0) {
      return [
        finding({
          id: 'AUDIO-001',
          code: 'AUDIO-001',
          severity: 'pass',
          category: 'audio',
          title: 'Speaker SPL threshold',
          message: `No in-coverage seats are below ${SPL_TARGET_MIN} dB (engineering estimate).`,
          explanation: AUDIO_METHOD,
          metric: { name: 'SPL threshold', actual: '≥ min for in-coverage seats', expected: `${SPL_TARGET_MIN} dB` },
          source: summary.methodology
        })
      ];
    }
    const sample = below[0];
    return [
      finding({
        id: 'AUDIO-001',
        code: 'AUDIO-001',
        severity: 'error',
        category: 'audio',
        title: 'Speaker coverage',
        message: `${below.length} seating position(s) fall below the configured coverage threshold.`,
        explanation: `${AUDIO_METHOD} Comfort ceiling ${SPL_TARGET_MAX} dB is a warning, not this check.`,
        metric: {
          name: 'Estimated SPL',
          actual: `${sample.splAtSeat} dB @ ${sample.distanceM} m`,
          expected: `≥ ${SPL_TARGET_MIN} dB (in-dispersion)`,
          unit: 'dB'
        },
        objectId: sample.contributingSpeakerId ?? undefined,
        affectedObjects: [
          ...below.map((r) => ({ kind: 'seat' as const, id: r.seatId, label: `Seat ${r.seatId}` })),
          ...usable.map((s) => ({ kind: 'equipment' as const, id: s.instanceId, label: s.name }))
        ],
        recommendedActions: ['Move speakers closer', 'Add speakers', 'Use a catalog model with higher maxSplAt1m'],
        potentialVariables: ['Speaker position', 'Speaker count', 'maxSplAt1m'],
        source: summary.methodology
      })
    ];
  }
};

export const checkSpeakerDispersionCoverage: ValidationCheck = {
  code: 'AUDIO-004',
  category: 'audio',
  title: 'Speaker dispersion coverage',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectSpeakers(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((s) => !s.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeSpeakerCoverage(ctx.seats, ctx.equipment, ctx.catalog);
    const outside = summary.seatResults.filter((r) => !r.inDispersion);
    if (outside.length === 0) {
      return [
        finding({
          id: 'AUDIO-004',
          code: 'AUDIO-004',
          severity: 'pass',
          category: 'audio',
          title: 'Speaker dispersion coverage',
          message: 'All seats lie inside at least one catalog dispersion region.',
          explanation: AUDIO_METHOD,
          source: summary.methodology
        })
      ];
    }
    return [
      finding({
        id: 'AUDIO-004',
        code: 'AUDIO-004',
        severity: 'error',
        category: 'audio',
        title: 'Speaker orientation / dispersion',
        message: `${outside.length} seat(s) are outside every speaker’s calculated dispersion region.`,
        explanation: 'Geometric dispersion test only. SPL is not assigned outside the cone/sector.',
        metric: { name: 'In dispersion', actual: 'false', expected: 'true' },
        objectId: usable[0]?.instanceId,
        affectedObjects: [
          ...outside.map((r) => ({ kind: 'seat' as const, id: r.seatId, label: `Seat ${r.seatId}` })),
          ...usable.map((s) => ({ kind: 'equipment' as const, id: s.instanceId, label: s.name }))
        ],
        recommendedActions: ['Rotate wall speakers toward seating', 'Add ceiling speakers', 'Review catalog dispersion'],
        potentialVariables: ['Speaker rotationY', 'Speaker position', 'dispersionDeg'],
        source: summary.methodology
      })
    ];
  }
};

export const checkSpeakerCoverageInsufficient: ValidationCheck = {
  code: 'AUDIO-002',
  category: 'audio',
  title: 'Insufficient speaker coverage',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectSpeakers(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((s) => !s.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeSpeakerCoverage(ctx.seats, ctx.equipment, ctx.catalog);
    const anyEstimatedCoverage = summary.seatResults.some(
      (r) => r.status === 'pass' || r.status === 'warning'
    );
    if (anyEstimatedCoverage) return [];
    return [
      finding({
        id: 'AUDIO-002',
        code: 'AUDIO-002',
        severity: 'error',
        category: 'audio',
        title: 'Insufficient speaker coverage',
        message: `0 of ${summary.totalSeats} seats meet the ${SPL_TARGET_MIN}–${SPL_TARGET_MAX} dB PASS band.`,
        explanation: AUDIO_METHOD,
        metric: {
          name: 'Seats passing SPL band',
          actual: '0',
          expected: String(summary.totalSeats)
        },
        affectedObjects: usable.map((s) => ({ kind: 'equipment' as const, id: s.instanceId, label: s.name })),
        recommendedActions: ['Revise speaker layout and re-run Validate Design'],
        potentialVariables: ['Speaker layout'],
        source: summary.methodology
      })
    ];
  }
};

export const checkCameraData: ValidationCheck = {
  code: 'CAM-003',
  category: 'camera',
  title: 'Camera FOV data',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectCameras(ctx.equipment, ctx.catalog);
    if (resolved.length === 0) return [];
    const incomplete = resolved.filter((c) => c.incomplete);
    if (incomplete.length) {
      return [
        finding({
          id: 'CAM-003',
          code: 'CAM-003',
          severity: 'warning',
          category: 'camera',
          title: 'Camera FOV data incomplete',
          message: `${incomplete.length} of ${resolved.length} camera(s) cannot be evaluated.`,
          explanation: incomplete.map((c) => c.incompleteReason ?? 'DATA INCOMPLETE').join(' '),
          metric: { name: 'horizontalFovDeg', actual: 'DATA INCOMPLETE', expected: 'Catalog horizontalFovDeg > 0' },
          affectedObjects: incomplete.map((c) => ({ kind: 'equipment' as const, id: c.instanceId, label: c.name })),
          recommendedActions: ['Supply datasheet horizontal FOV', 'Do not assume 60° or 90°'],
          potentialVariables: ['horizontalFovDeg'],
          source: 'EquipmentCatalog.camera'
        })
      ];
    }
    return [
      finding({
        id: 'CAM-003',
        code: 'CAM-003',
        severity: 'pass',
        category: 'camera',
        title: 'Camera FOV data',
        message: `${resolved.length} camera(s) have catalog horizontal FOV for the geometric frustum estimate.`,
        explanation: CAMERA_METHOD,
        source: 'EquipmentCatalog.camera'
      })
    ];
  }
};

export const checkCameraOutsideFov: ValidationCheck = {
  code: 'CAM-001',
  category: 'camera',
  title: 'Outside camera FOV',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectCameras(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((c) => !c.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeCameraCoverage(ctx.seats, ctx.equipment, ctx.catalog, ctx.room, ctx.tables);
    const outside = summary.seatResults.filter((r) => !r.inFov);
    if (outside.length === 0) {
      return [
        finding({
          id: 'CAM-001',
          code: 'CAM-001',
          severity: 'pass',
          category: 'camera',
          title: 'Camera FOV coverage',
          message: 'All seats lie inside at least one catalog FOV region.',
          explanation: CAMERA_METHOD,
          source: summary.methodology
        })
      ];
    }
    return [
      finding({
        id: 'CAM-001',
        code: 'CAM-001',
        severity: 'error',
        category: 'camera',
        title: 'Outside camera FOV',
        message: `${outside.length} seating position(s) are outside every camera's calculated horizontal FOV.`,
        explanation: CAMERA_METHOD,
        metric: { name: 'In FOV', actual: 'false', expected: 'true' },
        objectId: usable[0]?.instanceId,
        affectedObjects: [
          ...outside.map((r) => ({ kind: 'seat' as const, id: r.seatId, label: `Seat ${r.seatId}` })),
          ...usable.map((c) => ({ kind: 'equipment' as const, id: c.instanceId, label: c.name }))
        ],
        recommendedActions: ['Rotate or move the camera', 'Add another camera', 'Use catalog HFOV from a datasheet'],
        potentialVariables: ['Camera rotationY', 'Camera position', 'horizontalFovDeg'],
        source: summary.methodology
      })
    ];
  }
};

export const checkCameraBlockedSightline: ValidationCheck = {
  code: 'CAM-004',
  category: 'camera',
  title: 'Camera sightline blocked',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectCameras(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((c) => !c.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeCameraCoverage(ctx.seats, ctx.equipment, ctx.catalog, ctx.room, ctx.tables);
    const blocked = summary.seatResults.filter((r) => r.inFov && !r.visible);
    if (blocked.length === 0) {
      return [
        finding({
          id: 'CAM-004',
          code: 'CAM-004',
          severity: 'pass',
          category: 'camera',
          title: 'Camera sightline',
          message: 'No in-FOV seats are blocked by registered tables or columns.',
          explanation: CAMERA_METHOD,
          source: summary.methodology
        })
      ];
    }
    return [
      finding({
        id: 'CAM-004',
        code: 'CAM-004',
        severity: 'error',
        category: 'camera',
        title: 'Inside FOV but sightline blocked',
        message: `${blocked.length} seating position(s) are inside a camera FOV but blocked by a table or column.`,
        explanation: 'SightlineEngine ray vs tables/columns. Occupant bodies, chairs, doors, and glazing are not modeled.',
        metric: { name: 'Sightline', actual: 'blocked', expected: 'clear' },
        objectId: blocked[0].blockingCameraIds[0] ?? usable[0]?.instanceId,
        affectedObjects: [
          ...blocked.map((r) => ({ kind: 'seat' as const, id: r.seatId, label: `Seat ${r.seatId}` })),
          ...usable.map((c) => ({ kind: 'equipment' as const, id: c.instanceId, label: c.name }))
        ],
        recommendedActions: ['Raise or move the camera', 'Relocate seating/tables', 'Add a second camera with a clear path'],
        potentialVariables: ['Camera height', 'TableSpec', 'Columns'],
        source: summary.methodology
      })
    ];
  }
};

export const checkCameraCoverageInsufficient: ValidationCheck = {
  code: 'CAM-002',
  category: 'camera',
  title: 'Zero seats covered',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    const resolved = resolveProjectCameras(ctx.equipment, ctx.catalog);
    const usable = resolved.filter((c) => !c.incomplete);
    if (usable.length === 0 || ctx.seats.length === 0) return [];
    const summary = summarizeCameraCoverage(ctx.seats, ctx.equipment, ctx.catalog, ctx.room, ctx.tables);
    if (summary.visibleSeats > 0) return [];
    return [
      finding({
        id: 'CAM-002',
        code: 'CAM-002',
        severity: 'error',
        category: 'camera',
        title: 'Zero seats covered',
        message: `0 of ${summary.totalSeats} seats are geometrically visible to any camera.`,
        explanation: CAMERA_METHOD,
        metric: { name: 'Visible seats', actual: '0', expected: String(summary.totalSeats) },
        affectedObjects: usable.map((c) => ({ kind: 'equipment' as const, id: c.instanceId, label: c.name })),
        recommendedActions: ['Aim cameras at seating', 'Clear table/column occlusion', 'Add cameras'],
        potentialVariables: ['Camera layout'],
        source: summary.methodology
      })
    ];
  }
};

import { ROOM_CHECKS } from './roomChecks';
import { POWER_CHECKS } from './powerChecks';

export const BUILTIN_CHECKS: ValidationCheck[] = [
  checkDisplayData,
  checkDisplayOpenings,
  checkPresentationWall,
  checkSeatingPresent,
  checkWallClearance,
  checkViewingDistance,
  checkHorizontalAngle,
  checkVerticalAngle,
  checkVisibility,
  checkSightline,
  checkMicPickupData,
  checkMicDirectionalData,
  checkMicCoverageGap,
  checkSpeakerData,
  checkSpeakerSplThreshold,
  checkSpeakerDispersionCoverage,
  checkSpeakerCoverageInsufficient,
  checkCameraData,
  checkCameraOutsideFov,
  checkCameraBlockedSightline,
  checkCameraCoverageInsufficient,
  ...FURNITURE_CHECKS,
  ...EQUIPMENT_CHECKS,
  ...ROOM_CHECKS,
  ...POWER_CHECKS
];
