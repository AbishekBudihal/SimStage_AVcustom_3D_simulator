/**
 * powerChecks.ts
 * ────────────────────────────────────────────────────────────
 * Power delivery and rack thermal density validation (§15).
 *
 * Rules:
 * - POW-001: Rack Thermal / Power Dissipation — Warns if cumulative equipment draw in a rack exceeds convective airflow limits
 * - POW-002: Switch PoE Power Budget — Validates cumulative PoE endpoint draw against supplying switch budget
 * ────────────────────────────────────────────────────────────
 */

import type { ProjectValidationContext } from './ValidationContext';
import type { ValidationCheck, ValidationFinding } from './ValidationTypes';
import { resolveInstancePorts } from '../../system/PortResolver';

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

/**
 * POW-001: Evaluates cumulative heat/power dissipation per rack.
 * Standard unventilated enclosed/wall racks typically handle up to ~400W–600W naturally,
 * while large floor racks exceed thermal limits above ~1500W without active forced-air fan units.
 */
export const checkRackThermalBudget: ValidationCheck = {
  code: 'POW-001',
  category: 'power',
  title: 'Rack power and thermal density',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    if (!ctx.racks || ctx.racks.length === 0) return [];

    const findings: ValidationFinding[] = [];

    for (const rack of ctx.racks) {
      // Find all equipment assigned to this rack
      const rackEquip = ctx.equipment.filter((e) => e.rackId === rack.id);
      if (rackEquip.length === 0) continue;

      let totalWatts = 0;
      let unknownWattsCount = 0;

      for (const eq of rackEquip) {
        const prod = ctx.catalog.get(eq.productId);
        const watts = prod?.power?.powerWatts ?? prod?.physical?.powerWatts;
        if (watts != null) {
          totalWatts += watts;
        } else {
          unknownWattsCount++;
        }
      }

      // Convective thermal thresholds: 1200W for floor racks, 500W for wall racks
      const limitWatts = rack.kind === 'wall' ? 500 : 1200;

      if (totalWatts > limitWatts) {
        findings.push(
          finding({
            id: `POW-001:${rack.id}`,
            code: 'POW-001',
            severity: 'warning',
            category: 'power',
            title: 'High rack thermal density',
            message: `Rack ${rack.id} equipment dissipates ~${totalWatts}W (limit without active cooling: ${limitWatts}W).`,
            explanation: 'High thermal concentration in enclosed AV cabinets can cause component degradation and premature shutdown.',
            objectId: rack.id,
            affectedObjects: [{ kind: 'rack', id: rack.id, label: rack.id }],
            metric: { name: 'Power Dissipation', actual: `${totalWatts}W`, expected: `<${limitWatts}W` },
            recommendedActions: [
              'Specify an active thermostatically-controlled rack fan top unit or vented blank panels',
              'Distribute high-draw power amplifiers across multiple racks or separate credenzas'
            ],
            source: 'EquipmentProduct.power.powerWatts cumulative sum'
          })
        );
      }
    }

    if (findings.length > 0) return findings;

    return [
      finding({
        id: 'POW-001:pass',
        code: 'POW-001',
        severity: 'pass',
        category: 'power',
        title: 'Rack thermal dissipation',
        message: 'All equipment racks operate within natural convection thermal dissipation limits.',
        explanation: 'Cumulative equipment power draw is within standard thresholds.',
        source: 'EquipmentProduct.power.powerWatts'
      })
    ];
  }
};

/**
 * POW-002: Verifies total PoE power draw across PoE network switches against their published budget.
 */
export const checkSwitchPoeBudget: ValidationCheck = {
  code: 'POW-002',
  category: 'power',
  title: 'Network switch PoE power budget',
  evaluate(ctx: ProjectValidationContext): ValidationFinding[] {
    // Find network switches supplying PoE
    const switches = ctx.equipment.filter((e) => {
      const prod = ctx.catalog.get(e.productId);
      if (!prod) return false;
      const isSwitch =
        prod.category === 'network' ||
        prod.category === 'infrastructure' ||
        prod.model.toLowerCase().includes('switch') ||
        prod.model.toLowerCase().includes('m4250');
      return (
        isSwitch &&
        (prod.power?.poeClass?.toLowerCase().includes('pse') ||
          prod.ports?.some(
            (p) =>
              (p.poeBudgetWatts != null && p.poeBudgetWatts > 0) ||
              p.label.toLowerCase().includes('poe') ||
              p.capabilities?.some((c) => c.toLowerCase().includes('poe'))
          ))
      );
    });

    if (switches.length === 0) return [];

    const findings: ValidationFinding[] = [];

    for (const sw of switches) {
      const swProd = ctx.catalog.get(sw.productId)!;
      const switchPorts = resolveInstancePorts(sw.instanceId, sw.productId, ctx.catalog);
      const totalPortBudget = switchPorts.reduce((acc, p) => acc + (p.poeBudgetWatts ?? 0), 0);
      const budgetWatts = totalPortBudget > 0 ? totalPortBudget : 125; // default for 8-port PoE+ switch

      const poePorts = switchPorts.filter(
        (p) =>
          (p.poeBudgetWatts != null && p.poeBudgetWatts > 0) ||
          p.label.toLowerCase().includes('poe') ||
          p.capabilities?.some((c) => c.toLowerCase().includes('poe'))
      );

      let currentDrawWatts = 0;
      const poweredDevices: string[] = [];

      for (const p of poePorts) {
        // Look for connection to this port
        const conn = ctx.connections.find(
          (c) => (c.fromInstanceId === sw.instanceId && c.fromPortId === p.id) ||
                 (c.toInstanceId === sw.instanceId && c.toPortId === p.id)
        );
        if (!conn) continue;

        const otherId = conn.fromInstanceId === sw.instanceId ? conn.toInstanceId : conn.fromInstanceId;
        const otherEq = ctx.equipment.find((e) => e.instanceId === otherId);
        if (!otherEq) continue;

        const otherProd = ctx.catalog.get(otherEq.productId);
        if (otherProd?.power?.poeClass) {
          // Standard IEEE 802.3 power classes:
          // class 1: 4W, class 2: 7W, class 3: 15.4W, class 4 (PoE+): 30W, class 8 (PoE++): 90W
          const classW: Record<string, number> = {
            class1: 4.0,
            class2: 7.0,
            class3: 15.4,
            class4: 30.0,
            class6: 60.0,
            class8: 90.0
          };
          const cls = otherProd.power.poeClass.toLowerCase().replace(/[^a-z0-9]/g, '');
          const draw = classW[cls] ?? (otherProd.power.powerWatts ?? otherProd.physical?.powerWatts ?? 15.4);
          currentDrawWatts += draw;
          poweredDevices.push(otherEq.name);
        } else if (p.poeRequirementWatts != null && p.poeRequirementWatts > 0) {
          currentDrawWatts += p.poeRequirementWatts;
          poweredDevices.push(otherEq.name);
        } else if (otherProd?.power?.powerWatts || otherProd?.physical?.powerWatts) {
          const draw = otherProd.power?.powerWatts ?? otherProd.physical?.powerWatts ?? 0;
          currentDrawWatts += draw;
          poweredDevices.push(otherEq.name);
        }
      }

      if (currentDrawWatts > budgetWatts) {
        findings.push(
          finding({
            id: `POW-002:${sw.instanceId}`,
            code: 'POW-002',
            severity: 'error',
            category: 'power',
            title: 'Switch PoE budget exceeded',
            message: `${sw.name} PoE demand (~${currentDrawWatts.toFixed(1)}W) exceeds total switch capacity (${budgetWatts}W).`,
            explanation: 'Overdrawing PoE switches causes connected touch panels, ceiling microphones, and PTZ cameras to reset.',
            objectId: sw.instanceId,
            affectedObjects: [{ kind: 'equipment', id: sw.instanceId, label: sw.name }],
            metric: { name: 'PoE Load', actual: `${currentDrawWatts.toFixed(1)}W`, expected: `<${budgetWatts}W` },
            recommendedActions: [
              'Add a secondary PoE+ switch or dedicated midspan power injector',
              'Power high-draw PTZ cameras or speakers locally with auxiliary AC adapters'
            ],
            source: 'PortDefinition.poeBudgetWatts vs connected endpoint PoE draw'
          })
        );
      }
    }

    if (findings.length > 0) return findings;

    return [
      finding({
        id: 'POW-002:pass',
        code: 'POW-002',
        severity: 'pass',
        category: 'power',
        title: 'PoE power budget compliant',
        message: 'Network switch PoE budgets adequately supply all connected endpoints.',
        explanation: 'PoE load is within switch power supply margins.',
        source: 'PortDefinition.poeBudgetWatts'
      })
    ];
  }
};

export const POWER_CHECKS: ValidationCheck[] = [
  checkRackThermalBudget,
  checkSwitchPoeBudget
];
