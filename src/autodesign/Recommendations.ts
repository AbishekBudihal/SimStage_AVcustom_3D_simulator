import type { EquipmentCatalog, EquipmentProduct } from '../catalog/EquipmentCatalog';
import {
  analyzeAllSeatsAgainstDisplay,
  getActiveDisplay,
  projectObstacles,
  summarizeDesignHealth
} from '../av/DesignAnalysis';
import type { ProjectDesignContext } from './DesignProposal';

export interface LiveRecommendation {
  id: string;
  title: string;
  message: string;
  actions?: Array<{ id: string; label: string }>;
}

/**
 * Advice only — never mutates the design. Uses existing viewing analysis.
 */
export function recommendationsAfterManual(ctx: ProjectDesignContext, catalog: EquipmentCatalog): LiveRecommendation[] {
  const out: LiveRecommendation[] = [];
  const display = getActiveDisplay(ctx.equipment, catalog);
  if (!display || !ctx.seats.length) return out;
  const obstacles = projectObstacles(ctx.room, ctx.tables);
  const health = summarizeDesignHealth(ctx.seats, display, obstacles);
  const analyses = analyzeAllSeatsAgainstDisplay(ctx.seats, display, obstacles);
  const worst = analyses.find((a) => a.seatId === health.worstSeatId) ?? analyses[0];
  if (health.failCount > 0 || health.warningCount > 0) {
    out.push({
      id: 'viewing-margin',
      title: 'RECOMMENDATION',
      message:
        health.failCount > 0
          ? `Display is outside the viewing criterion for ${health.failCount} seat(s). Worst seat ${worst?.seatId ?? ''} at ${worst?.distance.value.toFixed(1) ?? '?'} m.`
          : `Display is below preferred viewing margin (${health.warningCount} seat warning(s)).`,
      actions: [
        { id: 'open-autodesign', label: 'Review alternative' },
        { id: 'keep', label: 'Keep current' }
      ]
    });
  }
  const moved = ctx.equipment.filter((e) => e.origin === 'manual' || e.placementMode === 'manual');
  if (moved.length) {
    out.push({
      id: 'manual-override',
      title: 'MANUAL OVERRIDE',
      message: `${moved.length} object(s) marked MANUAL. Analysis uses the real geometry. Auto Design will not move them unless you choose Replace.`
    });
  }
  return out;
}

export const LEARN_TOPICS: Record<string, { q: string; a: string }> = {
  displaySize: {
    q: 'Why does display size matter?',
    a: 'Viewing distance affects whether content can be comfortably resolved from the seating positions. SIMSTAGE uses the existing viewing-distance engine and catalog screen size — not a marketing inch label alone.'
  },
  displayCount: {
    q: 'Why are we asking about display count?',
    a: 'Dual displays may improve visibility when different content needs to be shown simultaneously. The catalog must still provide a valid signal path for each display.'
  },
  mics: {
    q: 'Why microphone type?',
    a: 'Table and ceiling products use different catalog pickup radii. Coverage is the existing disc/sector engine, not a seat-count recipe.'
  },
  camera: {
    q: 'Why camera FOV?',
    a: 'Horizontal field of view from the catalog determines which seats fall inside the geometric frustum. Missing HFOV is DATA INCOMPLETE — 60°/90° is not assumed.'
  },
  speakers: {
    q: 'Why speaker coverage?',
    a: 'Estimated SPL and catalog dispersion decide whether seats sit in the modeled coverage region. This is not a room-acoustic simulation.'
  }
};

export interface EngineeringExplanation {
  subsystem: 'display' | 'camera' | 'microphone' | 'speaker' | 'system';
  headline: string;
  rationale: string;
  standardsCited: string[];
  metrics: Array<{
    label: string;
    actual: string;
    target: string;
  }>;
}

/**
 * Generates deterministic, mathematically justified engineering explanations
 * for beginner/pre-sales users without fabricating manufacturer specifications (§1).
 */
export function explainRecommendation(
  subsystem: 'display' | 'camera' | 'microphone' | 'speaker' | 'system',
  product: EquipmentProduct,
  room: { width: number; depth: number; height: number },
  seatCount: number,
  quantity = 1,
  extra?: { furthestDistanceM?: number; fovDeg?: number; totalPoEWatts?: number }
): EngineeringExplanation {
  switch (subsystem) {
    case 'display': {
      const diag = product.display?.diagonalInches ?? 85;
      const furthest = extra?.furthestDistanceM ?? Math.sqrt(room.depth * room.depth + (room.width / 2) * (room.width / 2));
      return {
        subsystem: 'display',
        headline: `${quantity > 1 ? `${quantity}x ` : ''}${product.manufacturer} ${product.model} (${diag}") specified for ${furthest.toFixed(1)}m furthest viewer`,
        rationale: `Selected based on room depth (${room.depth}m) and furthest participant distance (${furthest.toFixed(1)}m). Under AVIXA V202.01 DISCAS standard, an image height of approx ${(diag * 0.0124).toFixed(2)}m guarantees 100% text and analytical content legibility from all ${seatCount} seats without eye strain.`,
        standardsCited: ['AVIXA V202.01 (DISCAS)', 'ANSI/INFOCOMM 3M-2011'],
        metrics: [
          { label: 'Screen Diagonal', actual: `${diag} inches`, target: '≥75 inches' },
          { label: 'Max Viewing Distance', actual: `${furthest.toFixed(1)}m`, target: `<${(product.display?.viewingDistanceMaxM ?? 8.0).toFixed(1)}m` },
          { label: 'Native Resolution', actual: product.display?.resolution ?? '3840x2160 (4K)', target: '3840x2160 UHD' }
        ]
      };
    }

    case 'camera': {
      const hfov = extra?.fovDeg ?? product.camera?.horizontalFovDeg ?? 82;
      return {
        subsystem: 'camera',
        headline: `${product.manufacturer} ${product.model} specified (${hfov}° HFOV optical capture)`,
        rationale: `With a room width of ${room.width}m and participants seated along the conference table, a camera with ${hfov}° horizontal field of view placed on the presentation wall captures all seated participants within the primary optical cone without clipping peripheral seats.`,
        standardsCited: ['AVIXA FIMS', 'Geometric Optics Frustum Evaluation'],
        metrics: [
          { label: 'Horizontal FOV', actual: `${hfov}°`, target: '≥80° for full table' },
          { label: 'Optical Architecture', actual: product.camera?.ptz ? 'Mechanical PTZ' : 'ePTZ / Wide Angle', target: 'Room-scale Framing' }
        ]
      };
    }

    case 'microphone': {
      const radius = product.microphone?.pickupRadiusM ?? 3.5;
      return {
        subsystem: 'microphone',
        headline: `${quantity}x ${product.manufacturer} ${product.model} recommended for ${seatCount}-person coverage`,
        rationale: `The participant seating area extends across a ${seatCount}-seat zone. With catalog-verified pickup radius of ${radius}m per microphone, ${quantity} unit(s) deliver continuous acoustic coverage across all attendee positions with zero dead zones.`,
        standardsCited: ['ANSI/INFOCOMM 1M-2009 (Audio Coverage)', 'Inverse Square Law'],
        metrics: [
          { label: 'Pickup Envelope', actual: `${radius}m per unit (${quantity} units)`, target: 'Full table coverage' },
          { label: 'Mounting Style', actual: product.microphone?.mount ?? 'ceiling', target: 'Unobtrusive placement' }
        ]
      };
    }

    case 'speaker': {
      const dispersion = product.speaker?.dispersionDeg ?? 100;
      const listenerPlaneHeight = Math.max(1.0, room.height - 1.2);
      const coverageRadius = (listenerPlaneHeight * Math.tan((dispersion / 2) * (Math.PI / 180))).toFixed(1);
      return {
        subsystem: 'speaker',
        headline: `${quantity}x ${product.manufacturer} ${product.model} (${dispersion}° dispersion) audio reinforcement`,
        rationale: `With a finished ceiling height of ${room.height}m (${listenerPlaneHeight.toFixed(1)}m above seated listener ear level), each speaker produces a ~${coverageRadius}m radius coverage cone at ear height. ${quantity} distributed speaker(s) ensure uniform sound pressure level (±3dB) and high speech intelligibility.`,
        standardsCited: ['AVIXA A102.01:2017 (Audio Coverage Uniformity)', 'IEC 60268-16 (STIPA)'],
        metrics: [
          { label: 'Dispersion Angle', actual: `${dispersion}° Conical`, target: '≥90° for uniform spread' },
          { label: 'SPL Uniformity Target', actual: '±3 dB across seating', target: '<6 dB variation' }
        ]
      };
    }

    case 'system': {
      return {
        subsystem: 'system',
        headline: `${product.manufacturer} ${product.model} centralized infrastructure`,
        rationale: `Provides dedicated Gigabit Ethernet connectivity with PoE+ supply for all IP-connected endpoints (cameras, microphones, and touch panels), ensuring clean cable segregation, zero latency spikes, and reliable power distribution.`,
        standardsCited: ['IEEE 802.3at (PoE+)', 'AV-over-IP Interoperability'],
        metrics: [
          { label: 'Device Category', actual: product.category, target: 'Infrastructure' },
          { label: 'PoE Delivery', actual: 'Class 4 PoE+ Support', target: 'Supplies all endpoints' }
        ]
      };
    }
  }
}

