import { useEffect, useRef } from "react";

export default function VillageModal({ village, onClose }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!village) return undefined;
    closeButtonRef.current?.focus();

    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [village, onClose]);

  if (!village) return null;

  return (
    <div
      className="modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="village-modal-title">
        <button
          ref={closeButtonRef}
          className="modal-close"
          type="button"
          aria-label="Close village details"
          onClick={onClose}
        >
          ×
        </button>
        <div className="eyebrow">VILLAGE DETAILS</div>
        <h2 id="village-modal-title">{village.name}</h2>
        <div className={`risk-badge ${village.risk.toLowerCase()}`}>{village.risk}</div>
        <div className="detail-grid">
          <div><span>Risk score</span><strong>{village.score}/100</strong></div>
          <div><span>Rainfall</span><strong>{village.rain}</strong></div>
          <div><span>Soil moisture</span><strong>{village.soil}</strong></div>
          <div><span>Stream distance</span><strong>{village.stream}</strong></div>
          <div><span>Slope</span><strong>{village.slope}</strong></div>
          <div><span>Catchment</span><strong>{village.catchment}</strong></div>
        </div>
        <div className="modal-note">
          Risk is a preparedness indicator, not a claim of exact inundation at the village.
        </div>
      </div>
    </div>
  );
}
