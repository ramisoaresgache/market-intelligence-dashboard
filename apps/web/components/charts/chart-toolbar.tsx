type ChartToolbarProps = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onExport: () => void;
  exportLabel?: string;
};

export function ChartToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onExport,
  exportLabel = "Export PNG",
}: ChartToolbarProps) {
  return (
    <div className="chart-toolbar" aria-label="Chart controls">
      <button type="button" onClick={onZoomOut} aria-label="Zoom out">−</button>
      <span>{zoom.toFixed(1)}×</span>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in">+</button>
      <button type="button" className="text-control" onClick={onReset}>Reset</button>
      <button type="button" className="export-control" onClick={onExport}>
        <DownloadIcon /> {exportLabel}
      </button>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v7m0 0 3-3M8 9 5 6M3 11v2h10v-2" />
    </svg>
  );
}
