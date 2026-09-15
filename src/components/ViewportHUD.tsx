import type { WorkspaceView } from '../workspace/CanvasManager';
export function ViewportHUD({ view, onChange, disabled }: { view: WorkspaceView; onChange: (view: WorkspaceView) => void; disabled: boolean }) {
  return <div role="toolbar" aria-label="Viewport camera" className="flex flex-wrap gap-1 rounded-lg border border-solid border-slate-700 bg-slate-900 p-1">
    {([['plan', '2D Plan'], ['isometric', '3D Isometric'], ['seat', 'Seat View']] as const).map(([mode, label]) =>
      <button key={mode} disabled={disabled} aria-pressed={view === mode} title={mode === 'seat' ? 'Fixed seated-eye perspective at 1.2 m, facing the front wall' : label}
        onClick={() => onChange(mode)} className={`rounded-md border-0 px-3 py-2 text-xs font-medium ${view === mode ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-300 hover:bg-slate-800'}`}>{label}</button>)}
  </div>;
}
