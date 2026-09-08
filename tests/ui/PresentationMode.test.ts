import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from '../../src/app/AppState';
import { createDefaultRoom } from '../../src/room/RoomModel';

describe('Phase 14: Client Presentation Mode (§20, §25, §28)', () => {
  let state: AppState;

  beforeEach(() => {
    state = new AppState();
    state.room = {
      ...createDefaultRoom('boardroom'),
      width: 8,
      depth: 6,
      height: 3
    };
    state.project.name = 'Executive Boardroom Solution';
    state.project.roomUseCase = 'boardroom';
    state.seats = [
      { id: 's1', x: 0, z: 0, row: 0, indexInRow: 0, facing: 0, hasTable: true },
      { id: 's2', x: 1, z: 0, row: 0, indexInRow: 1, facing: 0, hasTable: true },
      { id: 's3', x: -1, z: 0, row: 0, indexInRow: 2, facing: 0, hasTable: true }
    ];
  });

  it('initializes with presentationMode off and deterministic defaults', () => {
    expect(state.presentationMode).toBe(false);
    expect(state.presentationStop).toBe('overview');
    expect(state.presentationOverlays.sightlines).toBe(true);
    expect(state.presentationOverlays.audio).toBe(false);
    expect(state.presentationOverlays.mic).toBe(false);
    expect(state.presentationOverlays.camera).toBe(false);
  });

  it('enters presentation mode, collapses sidebars, switches to 3D, and remembers layout', () => {
    state.leftPanelCollapsed = false;
    state.rightPanelCollapsed = false;
    state.viewMode = 'plan';
    state.select('seat', 's1');

    state.enterPresentationMode();

    expect(state.presentationMode).toBe(true);
    expect(state.viewMode).toBe('3d');
    expect(state.leftPanelCollapsed).toBe(true);
    expect(state.rightPanelCollapsed).toBe(true);
    expect(state.selection.kind).toBe('none');
    expect(state.presentationStop).toBe('overview');
    expect(state.presentationSavedPanels).toEqual({ leftCollapsed: false, rightCollapsed: false });

    // Exiting restores original layout panels
    state.exitPresentationMode();
    expect(state.presentationMode).toBe(false);
    expect(state.leftPanelCollapsed).toBe(false);
    expect(state.rightPanelCollapsed).toBe(false);
    expect(state.presentationSavedPanels).toBeNull();
  });

  it('toggles presentation mode state on and off via togglePresentationMode()', () => {
    expect(state.presentationMode).toBe(false);
    state.togglePresentationMode();
    expect(state.presentationMode).toBe(true);
    state.togglePresentationMode();
    expect(state.presentationMode).toBe(false);
  });

  it('cycles through tour stops correctly with directional stepping and wrapping', () => {
    state.enterPresentationMode();
    expect(state.presentationStop).toBe('overview');

    state.stepPresentationStop(1);
    expect(state.presentationStop).toBe('presenter');

    state.stepPresentationStop(1);
    expect(state.presentationStop).toBe('seated');

    state.stepPresentationStop(1);
    expect(state.presentationStop).toBe('display');

    state.stepPresentationStop(1);
    expect(state.presentationStop).toBe('overview');

    state.stepPresentationStop(-1);
    expect(state.presentationStop).toBe('display');

    state.setPresentationStop('seated');
    expect(state.presentationStop).toBe('seated');
  });

  it('toggles non-technical presentation capability overlays', () => {
    expect(state.presentationOverlays.sightlines).toBe(true);
    state.togglePresentationOverlay('sightlines');
    expect(state.presentationOverlays.sightlines).toBe(false);

    expect(state.presentationOverlays.audio).toBe(false);
    state.togglePresentationOverlay('audio');
    expect(state.presentationOverlays.audio).toBe(true);

    expect(state.presentationOverlays.mic).toBe(false);
    state.togglePresentationOverlay('mic');
    expect(state.presentationOverlays.mic).toBe(true);

    expect(state.presentationOverlays.camera).toBe(false);
    state.togglePresentationOverlay('camera');
    expect(state.presentationOverlays.camera).toBe(true);
  });

  it('preserves single-source-of-truth integrity — room, seats, equipment and topology remain untouched', () => {
    state.addEquipment({
      instanceId: 'eq1',
      productId: 'lg-86uh5j',
      name: 'Main Display',
      position: { x: 0, y: 1.5, z: -3 },
      rotationY: 0
    });

    const initialEquipCount = state.equipment.length;
    const initialSeatsCount = state.seats.length;
    const initialRoomWidth = state.room!.width;

    state.enterPresentationMode();
    state.setPresentationStop('display');
    state.togglePresentationOverlay('mic');
    state.togglePresentationOverlay('audio');

    // Underlying model MUST NOT mutate
    expect(state.equipment.length).toBe(initialEquipCount);
    expect(state.seats.length).toBe(initialSeatsCount);
    expect(state.room!.width).toBe(initialRoomWidth);
    expect(state.equipment[0].position.z).toBe(-3);

    state.exitPresentationMode();
    expect(state.equipment.length).toBe(initialEquipCount);
    expect(state.seats.length).toBe(initialSeatsCount);
  });

  it('notifies subscribers upon presentation mode changes', async () => {
    let callCount = 0;
    state.subscribe(() => {
      callCount++;
    });

    state.enterPresentationMode();
    await Promise.resolve();
    expect(callCount).toBe(1);

    state.setPresentationStop('presenter');
    await Promise.resolve();
    expect(callCount).toBe(2);

    state.togglePresentationOverlay('camera');
    await Promise.resolve();
    expect(callCount).toBe(3);

    state.exitPresentationMode();
    await Promise.resolve();
    expect(callCount).toBe(4);
  });
});
