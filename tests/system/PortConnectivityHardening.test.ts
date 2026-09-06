import { describe, it, expect } from 'vitest';
import {
  canConnectPorts,
  checkBandwidthCompatibility,
  checkPoeCompatibility,
  checkProtocolCompatibility
} from '../../src/system/PortCompatibility';
import {
  checkPortBandwidth,
  checkPortPoe,
  checkProtocolMismatch
} from '../../src/av/validation/systemChecks';
import { EquipmentCatalog, type EquipmentProduct, type EquipmentInstance } from '../../src/catalog/EquipmentCatalog';
import type { ResolvedPort, SystemConnection } from '../../src/system/SystemTypes';
import type { ProjectValidationContext } from '../../src/av/validation/ValidationContext';
import { createDefaultRoom } from '../../src/room/RoomModel';

describe('Port Metadata & Connectivity Validation Hardening (§12)', () => {
  const basePort: ResolvedPort = {
    id: 'port-1',
    label: 'Port 1',
    instanceId: 'dev-1',
    productId: 'prod-1',
    origin: 'catalog',
    direction: 'output',
    signalTypes: ['VIDEO'],
    connector: 'hdmi',
    transport: 'hdmi'
  };

  describe('Protocol Interoperability (§12)', () => {
    it('allows identical protocols to connect', () => {
      const p1: ResolvedPort = { ...basePort, protocol: 'Dante' };
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input', protocol: 'dante' };
      const res = checkProtocolCompatibility(p1, p2);
      expect(res.ok).toBe(true);
    });

    it('allows Dante and AES67 interoperability', () => {
      const p1: ResolvedPort = { ...basePort, protocol: 'Dante' };
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input', protocol: 'AES67' };
      const res = checkProtocolCompatibility(p1, p2);
      expect(res.ok).toBe(true);
    });

    it('rejects conflicting protocols with informative reason', () => {
      const p1: ResolvedPort = { ...basePort, protocol: 'Dante' };
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input', protocol: 'VISCA' };
      const res = checkProtocolCompatibility(p1, p2);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('Protocol conflict');
    });

    it('rejects connection in canConnectPorts when protocols conflict with code CONN-011', () => {
      const p1: ResolvedPort = {
        ...basePort,
        direction: 'output',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK'],
        protocol: 'Dante'
      };
      const p2: ResolvedPort = {
        ...basePort,
        id: 'port-2',
        instanceId: 'dev-2',
        direction: 'input',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK'],
        protocol: 'VISCA'
      };
      const connResult = canConnectPorts(p1, p2);
      expect(connResult.ok).toBe(false);
      if (!connResult.ok) {
        expect(connResult.code).toBe('CONN-011');
      }
    });
  });

  describe('Bandwidth Bottleneck Analysis (§12)', () => {
    it('flags bottleneck when transmitter exceeds receiver interface bandwidth', () => {
      const p1: ResolvedPort = { ...basePort, bandwidthGbps: 48 }; // HDMI 2.1
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input', bandwidthGbps: 18 }; // HDMI 2.0
      const res = checkBandwidthCompatibility(p1, p2);
      expect(res.bottleneck).toBe(true);
      expect(res.message).toContain('48 Gbps');
      expect(res.message).toContain('18 Gbps');
    });

    it('does not flag bottleneck when receiver matches or exceeds transmitter bandwidth', () => {
      const p1: ResolvedPort = { ...basePort, bandwidthGbps: 18 };
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input', bandwidthGbps: 18 };
      const res = checkBandwidthCompatibility(p1, p2);
      expect(res.bottleneck).toBe(false);
    });

    it('passes safely when bandwidth is unknown on either side', () => {
      const p1: ResolvedPort = { ...basePort, bandwidthGbps: 18 };
      const p2: ResolvedPort = { ...basePort, id: 'port-2', instanceId: 'dev-2', direction: 'input' };
      const res = checkBandwidthCompatibility(p1, p2);
      expect(res.bottleneck).toBe(false);
    });
  });

  describe('PoE Power Delivery & Budget Validation (§12)', () => {
    it('detects when a PoE-requiring port connects to a non-PoE port', () => {
      const nonPsePort: ResolvedPort = {
        ...basePort,
        direction: 'bidirectional',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK']
      };
      const pdPort: ResolvedPort = {
        ...basePort,
        id: 'cam-lan',
        instanceId: 'cam-1',
        direction: 'bidirectional',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK', 'POWER'],
        poeRequirementWatts: 25.5
      };

      const res = checkPoeCompatibility(nonPsePort, pdPort);
      expect(res.ok).toBe(false);
      expect(res.isPoeLink).toBe(true);
      expect(res.message).toContain('does not supply PoE power');
    });

    it('verifies valid connection when PSE port supplies adequate power', () => {
      const psePort: ResolvedPort = {
        ...basePort,
        direction: 'bidirectional',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK', 'POWER'],
        poeBudgetWatts: 30
      };
      const pdPort: ResolvedPort = {
        ...basePort,
        id: 'cam-lan',
        instanceId: 'cam-1',
        direction: 'bidirectional',
        connector: 'rj45',
        transport: 'ethernet',
        signalTypes: ['NETWORK', 'POWER'],
        poeRequirementWatts: 15.4
      };

      const res = checkPoeCompatibility(psePort, pdPort);
      expect(res.ok).toBe(true);
      expect(res.isPoeLink).toBe(true);
    });
  });

  describe('System Validation Engine Integration', () => {
    function makeContext(
      equipment: EquipmentInstance[],
      catalog: EquipmentCatalog,
      connections: SystemConnection[]
    ): ProjectValidationContext {
      return {
        room: createDefaultRoom('conference'),
        seats: [],
        tables: [],
        equipment,
        connections,
        racks: [],
        catalog,
        routes: [],
        display: { kind: 'none' },
        seatAnalyses: [],
        obstacles: [],
        cableLengthLimitsM: {}
      };
    }

    it('evaluates checkPortBandwidth and generates CONN-009 warning finding', () => {
      const catalog = new EquipmentCatalog();
      const p1: EquipmentProduct = {
        id: 'gen-src',
        manufacturer: 'VendorA',
        model: 'MediaServer-8K',
        category: 'source',
        type: 'source',
        provenance: 'verified',
        physical: { width: 0.4, height: 0.05, depth: 0.3 },
        ports: [
          { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi', bandwidthGbps: 48 }
        ]
      };
      const p2: EquipmentProduct = {
        id: 'gen-disp',
        manufacturer: 'VendorB',
        model: 'Display-1080P',
        category: 'display',
        type: 'display',
        provenance: 'verified',
        physical: { width: 1.2, height: 0.7, depth: 0.08 },
        ports: [
          { id: 'hdmi-in', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi', bandwidthGbps: 10.2 }
        ]
      };
      catalog.register([p1, p2]);

      const eq: EquipmentInstance[] = [
        { instanceId: 'src-1', productId: 'gen-src', name: 'MediaServer-8K', position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
        { instanceId: 'disp-1', productId: 'gen-disp', name: 'Display-1080P', position: { x: 0, y: 0, z: 2 }, rotationY: 0 }
      ];

      const conns: SystemConnection[] = [
        {
          id: 'c-1',
          fromInstanceId: 'src-1',
          fromPortId: 'hdmi-out',
          toInstanceId: 'disp-1',
          toPortId: 'hdmi-in',
          signalType: 'VIDEO',
          transport: 'hdmi',
          physicalMedium: 'HDMI'
        }
      ];

      const findings = checkPortBandwidth.evaluate(makeContext(eq, catalog, conns));
      expect(findings.length).toBe(1);
      expect(findings[0].code).toBe('CONN-009');
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('Bandwidth bottleneck');
    });

    it('evaluates checkPortPoe and generates CONN-010 error for unpowered PoE equipment', () => {
      const catalog = new EquipmentCatalog();
      const switchProd: EquipmentProduct = {
        id: 'basic-switch',
        manufacturer: 'Cisco',
        model: 'CBS-NonPoE',
        category: 'network',
        type: 'network_switch',
        provenance: 'verified',
        physical: { width: 0.44, height: 0.044, depth: 0.25 },
        ports: [
          { id: 'p1', label: 'Port 1', direction: 'bidirectional', signalTypes: ['NETWORK'], connector: 'rj45' }
        ]
      };
      const micProd: EquipmentProduct = {
        id: 'poe-mic',
        manufacturer: 'Shure',
        model: 'MXA310',
        category: 'microphone',
        type: 'microphone',
        provenance: 'verified',
        physical: { width: 0.14, height: 0.04, depth: 0.14 },
        ports: [
          { id: 'lan', label: 'Dante/PoE', direction: 'bidirectional', signalTypes: ['NETWORK', 'POWER', 'AUDIO'], connector: 'rj45', poeRequirementWatts: 15.4 }
        ]
      };
      catalog.register([switchProd, micProd]);

      const eq: EquipmentInstance[] = [
        { instanceId: 'sw-1', productId: 'basic-switch', name: 'Switch', position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
        { instanceId: 'mic-1', productId: 'poe-mic', name: 'Ceiling Mic', position: { x: 0, y: 2.8, z: 0 }, rotationY: 0 }
      ];

      const conns: SystemConnection[] = [
        {
          id: 'c-poe',
          fromInstanceId: 'sw-1',
          fromPortId: 'p1',
          toInstanceId: 'mic-1',
          toPortId: 'lan',
          signalType: 'NETWORK',
          transport: 'ethernet',
          physicalMedium: 'Cat6'
        }
      ];

      const findings = checkPortPoe.evaluate(makeContext(eq, catalog, conns));
      expect(findings.length).toBe(1);
      expect(findings[0].code).toBe('CONN-010');
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('requires PoE');
    });

    it('evaluates checkPortPoe budget and generates CONN-010 error when aggregated PoE load exceeds PSE budget', () => {
      const catalog = new EquipmentCatalog();
      const poeSwitchProd: EquipmentProduct = {
        id: 'poe-switch',
        manufacturer: 'Netgear',
        model: 'M4250-PoE',
        category: 'network',
        type: 'network_switch',
        provenance: 'verified',
        physical: { width: 0.44, height: 0.044, depth: 0.25 },
        ports: [
          { id: 'p1', label: 'Port 1', direction: 'bidirectional', signalTypes: ['NETWORK', 'POWER'], connector: 'rj45', poeBudgetWatts: 30 }
        ]
      };
      const heavyCamProd: EquipmentProduct = {
        id: 'heavy-ptz',
        manufacturer: 'Sony',
        model: 'BRC-X1000',
        category: 'camera',
        type: 'camera',
        provenance: 'verified',
        physical: { width: 0.2, height: 0.25, depth: 0.2 },
        ports: [
          { id: 'lan', label: 'LAN', direction: 'bidirectional', signalTypes: ['NETWORK', 'POWER'], connector: 'rj45', poeRequirementWatts: 60 }
        ]
      };
      catalog.register([poeSwitchProd, heavyCamProd]);

      const eq: EquipmentInstance[] = [
        { instanceId: 'sw-1', productId: 'poe-switch', name: 'PoE Switch', position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
        { instanceId: 'cam-1', productId: 'heavy-ptz', name: 'PTZ Camera', position: { x: 0, y: 2, z: 0 }, rotationY: 0 }
      ];

      const conns: SystemConnection[] = [
        {
          id: 'c-ptz',
          fromInstanceId: 'sw-1',
          fromPortId: 'p1',
          toInstanceId: 'cam-1',
          toPortId: 'lan',
          signalType: 'NETWORK',
          transport: 'ethernet',
          physicalMedium: 'Cat6'
        }
      ];

      const findings = checkPortPoe.evaluate(makeContext(eq, catalog, conns));
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.code === 'CONN-010')).toBe(true);
    });
  });
});
