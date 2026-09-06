/**
 * demoSchematics.ts
 * Built-in enterprise reference schematics for demo and testing.
 * Uses real manufacturer product lines and standard AV signal flows.
 */

import type { SchematicGraph } from './SchematicTypes';

/**
 * Enterprise Boardroom: Dual 86" displays, ceiling mic,
 * DSP, power amplifier, PTZ camera, 4K switcher, 42U rack.
 */
export function boardroomSchematic(): SchematicGraph {
  return {
    metadata: {
      title: 'Enterprise Boardroom — Dual Display',
      designer: 'AV Engineering',
      revision: '1.0',
      targetRoom: { widthM: 10, depthM: 7, heightM: 3 }
    },
    nodes: [
      {
        id: 'laptop-1',
        label: 'Presenter Laptop',
        category: 'source',
        position2D: { x: 100, y: 300 },
        ports: [
          { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'usbc-out', label: 'USB-C OUT', direction: 'output', signalTypes: ['USB'], connector: 'usbc' }
        ]
      },
      {
        id: 'switcher-1',
        label: 'Extron DTP CrossPoint 84',
        category: 'switcher',
        manufacturer: 'Extron',
        model: 'DTP CrossPoint 84',
        rackMountable: true,
        ruHeight: 2,
        powerWatts: 65,
        position2D: { x: 300, y: 300 },
        ports: [
          { id: 'hdmi-in-1', label: 'HDMI IN 1', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'hdmi-in-2', label: 'HDMI IN 2', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'hdmi-out-1', label: 'HDMI OUT 1', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'hdmi-out-2', label: 'HDMI OUT 2', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' }
        ]
      },
      {
        id: 'display-1',
        label: 'Samsung QM86R Display L',
        category: 'display',
        manufacturer: 'Samsung',
        mountingPreference: 'wall',
        powerWatts: 280,
        position2D: { x: 500, y: 100 },
        ports: [
          { id: 'hdmi-in', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' }
        ]
      },
      {
        id: 'display-2',
        label: 'Samsung QM86R Display R',
        category: 'display',
        manufacturer: 'Samsung',
        mountingPreference: 'wall',
        powerWatts: 280,
        position2D: { x: 500, y: 500 },
        ports: [
          { id: 'hdmi-in', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' }
        ]
      },
      {
        id: 'mic-1',
        label: 'Shure MXA920 Ceiling Mic',
        category: 'microphone',
        manufacturer: 'Shure',
        mountingPreference: 'ceiling',
        powerWatts: 12,
        poeClass: 'PoE+ (30W)',
        position2D: { x: 300, y: 100 },
        ports: [
          { id: 'dante-out', label: 'DANTE OUT', direction: 'output', signalTypes: ['DANTE', 'AUDIO'], connector: 'rj45', protocol: 'Dante' }
        ]
      },
      {
        id: 'dsp-1',
        label: 'Biamp TesiraForte AVB',
        category: 'dsp',
        manufacturer: 'Biamp',
        rackMountable: true,
        ruHeight: 1,
        powerWatts: 40,
        position2D: { x: 300, y: 500 },
        ports: [
          { id: 'dante-in', label: 'DANTE IN', direction: 'input', signalTypes: ['DANTE', 'AUDIO'], connector: 'rj45', protocol: 'Dante' },
          { id: 'analog-out', label: 'ANALOG OUT', direction: 'output', signalTypes: ['AUDIO'], connector: 'phoenix' }
        ]
      },
      {
        id: 'amp-1',
        label: 'QSC CX302V Power Amplifier',
        category: 'amplifier',
        manufacturer: 'QSC',
        rackMountable: true,
        ruHeight: 2,
        powerWatts: 600,
        position2D: { x: 500, y: 600 },
        ports: [
          { id: 'analog-in', label: 'ANALOG IN', direction: 'input', signalTypes: ['AUDIO'], connector: 'phoenix' },
          { id: 'speaker-out', label: 'SPEAKER OUT', direction: 'output', signalTypes: ['AUDIO'], connector: 'speakon' }
        ]
      },
      {
        id: 'speaker-1',
        label: 'JBL Control 26CT Ceiling Speaker',
        category: 'speaker',
        manufacturer: 'JBL',
        mountingPreference: 'ceiling',
        position2D: { x: 700, y: 600 },
        ports: [
          { id: 'speaker-in', label: 'SPEAKER IN', direction: 'input', signalTypes: ['AUDIO'], connector: 'speakon' }
        ]
      },
      {
        id: 'camera-1',
        label: 'PTZ Camera',
        category: 'camera',
        mountingPreference: 'wall',
        position2D: { x: 500, y: 300 },
        ports: [
          { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' }
        ]
      }
    ],
    links: [
      { id: 'lk-1', fromNodeId: 'laptop-1', fromPortId: 'hdmi-out', toNodeId: 'switcher-1', toPortId: 'hdmi-in-1', signalType: 'VIDEO', physicalMedium: 'HDMI' },
      { id: 'lk-2', fromNodeId: 'camera-1', fromPortId: 'hdmi-out', toNodeId: 'switcher-1', toPortId: 'hdmi-in-2', signalType: 'VIDEO', physicalMedium: 'HDMI' },
      { id: 'lk-3', fromNodeId: 'switcher-1', fromPortId: 'hdmi-out-1', toNodeId: 'display-1', toPortId: 'hdmi-in', signalType: 'VIDEO', physicalMedium: 'HDMI' },
      { id: 'lk-4', fromNodeId: 'switcher-1', fromPortId: 'hdmi-out-2', toNodeId: 'display-2', toPortId: 'hdmi-in', signalType: 'VIDEO', physicalMedium: 'HDMI' },
      { id: 'lk-5', fromNodeId: 'mic-1', fromPortId: 'dante-out', toNodeId: 'dsp-1', toPortId: 'dante-in', signalType: 'DANTE', physicalMedium: 'Cat6' },
      { id: 'lk-6', fromNodeId: 'dsp-1', fromPortId: 'analog-out', toNodeId: 'amp-1', toPortId: 'analog-in', signalType: 'AUDIO' },
      { id: 'lk-7', fromNodeId: 'amp-1', fromPortId: 'speaker-out', toNodeId: 'speaker-1', toPortId: 'speaker-in', signalType: 'AUDIO' }
    ]
  };
}

/**
 * Huddle Space: Single display, all-in-one USB soundbar/camera.
 * No rack required — peripherals only.
 */
export function huddleSchematic(): SchematicGraph {
  return {
    metadata: {
      title: 'Huddle Space — Quick Collaboration',
      targetRoom: { widthM: 4, depthM: 3, heightM: 2.7 }
    },
    nodes: [
      {
        id: 'display-h1',
        label: '55" Display',
        category: 'display',
        mountingPreference: 'wall',
        position2D: { x: 200, y: 100 },
        ports: [
          { id: 'hdmi-in', label: 'HDMI IN', direction: 'input', signalTypes: ['VIDEO'], connector: 'hdmi' }
        ]
      },
      {
        id: 'bar-h1',
        label: 'Poly Studio USB Soundbar',
        category: 'codec',
        mountingPreference: 'table',
        position2D: { x: 200, y: 300 },
        ports: [
          { id: 'hdmi-out', label: 'HDMI OUT', direction: 'output', signalTypes: ['VIDEO'], connector: 'hdmi' },
          { id: 'usb-up', label: 'USB HOST', direction: 'bidirectional', signalTypes: ['USB'], connector: 'usbc' }
        ]
      }
    ],
    links: [
      { id: 'lk-h1', fromNodeId: 'bar-h1', fromPortId: 'hdmi-out', toNodeId: 'display-h1', toPortId: 'hdmi-in', signalType: 'VIDEO', physicalMedium: 'HDMI' }
    ]
  };
}
