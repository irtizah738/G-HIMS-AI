/**
 * Public-facing Helixis AI demo mark.
 * Display-only: no identity, tenant, runtime or clinical-data dependencies.
 * The custom helix motif is implemented in SVG to remain crisp at every size.
 */
export function HelixisDemoBrandMark() {
  return (
    <div className="flex items-center gap-3" aria-label="Helixis AI Clinical Intelligence">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#48CAE4]/40 bg-[#0B132B] shadow-[0_0_0_1px_rgba(0,245,212,0.06)]">
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-8 w-8" fill="none">
          <path d="M10 5C10 17 38 15 38 24S10 31 10 43"
            stroke="#48CAE4" strokeWidth="5" strokeLinecap="square" />
          <path d="M38 5C38 17 10 15 10 24S38 31 38 43"
            stroke="#00F5D4" strokeWidth="5" strokeLinecap="square" />
          <path d="M14 13H34M14 35H34" stroke="#F8F9FA"
            strokeWidth="2" strokeLinecap="square" opacity=".85" />
        </svg>
      </div>
      <div>
        <div className="flex items-baseline gap-2 text-[15px] leading-none">
          <span className="font-light uppercase tracking-[.19em] text-[#F8F9FA]">Helixis</span>
          <span className="font-bold uppercase tracking-[.09em] text-[#00F5D4]">AI</span>
        </div>
        <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-[#48CAE4]">
          Clinical Intelligence
        </p>
      </div>
    </div>
  );
}
