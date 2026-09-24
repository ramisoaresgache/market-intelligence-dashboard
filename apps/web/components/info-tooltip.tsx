type InfoTooltipProps = {
  label: string;
  text: string;
};

export function InfoTooltip({ label, text }: InfoTooltipProps) {
  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={`${label}: ${text}`}
      >
        i
      </button>
      <span className="info-tooltip-content" role="tooltip">
        {text}
      </span>
    </span>
  );
}
