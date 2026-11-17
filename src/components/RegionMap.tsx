// Simplified, clickable map of the UK's broad areas (deliberately blobby, not administrative boundaries).
// Shapes are rough lng/lat outlines projected to SVG; region keys match REGIONS in src/lib/firms.server.ts.
const SHAPES: Record<string, [number, number][][]> = {
  scot_north: [
    [[-5.2, 58.62], [-3.0, 58.65], [-1.8, 57.65], [-2.05, 57.1], [-2.45, 56.6], [-3.4, 56.4], [-4.5, 56.45], [-5.6, 56.55], [-6.2, 56.9], [-5.7, 57.3], [-5.8, 57.9], [-5.1, 58.3]],
    [[-6.2, 58.5], [-6.6, 58.4], [-7.3, 57.6], [-7.5, 57.0], [-7.2, 56.95], [-6.9, 57.5], [-6.4, 58.0]],
    [[-3.4, 59.1], [-2.4, 59.3], [-2.6, 58.8], [-3.3, 58.75]],
    [[-1.6, 60.6], [-0.8, 60.8], [-1.0, 60.0], [-1.4, 59.85]],
  ],
  scot_central: [[[-5.6, 56.55], [-4.5, 56.45], [-3.4, 56.4], [-2.45, 56.6], [-2.6, 56.2], [-2.1, 55.95], [-3.0, 55.8], [-4.0, 55.72], [-4.9, 55.75], [-5.5, 55.85], [-5.8, 56.25]]],
  scot_south: [[[-4.9, 55.75], [-4.0, 55.72], [-3.0, 55.8], [-2.1, 55.95], [-1.75, 55.65], [-2.6, 55.2], [-3.1, 54.95], [-4.2, 54.75], [-5.15, 54.85], [-4.9, 55.3]]],
  ni: [[[-8.15, 54.45], [-7.55, 55.2], [-6.2, 55.25], [-5.45, 54.6], [-6.0, 54.05], [-7.05, 54.1]]],
  eng_north: [[[-3.1, 54.95], [-2.6, 55.2], [-1.75, 55.65], [-1.3, 54.9], [-0.1, 54.15], [0.15, 53.6], [-0.6, 53.3], [-3.05, 53.3], [-3.2, 53.85], [-3.6, 54.5]]],
  wales: [[[-4.7, 53.3], [-3.05, 53.3], [-3.0, 52.5], [-3.1, 51.85], [-2.65, 51.6], [-3.3, 51.4], [-4.3, 51.65], [-5.3, 51.8], [-4.4, 52.3], [-4.1, 52.9], [-4.75, 52.8]]],
  eng_mid: [[[-3.05, 53.3], [-0.6, 53.3], [0.3, 53.0], [1.75, 52.7], [1.6, 52.0], [0.0, 52.0], [-1.8, 52.0], [-3.1, 51.85], [-3.0, 52.5]]],
  eng_sw: [[[-3.1, 51.85], [-1.8, 52.0], [-1.8, 51.0], [-1.9, 50.65], [-3.4, 50.6], [-4.2, 50.35], [-5.7, 50.05], [-4.5, 50.9], [-3.0, 51.25], [-2.65, 51.6]]],
  eng_se: [[[-1.8, 52.0], [0.0, 52.0], [1.6, 52.0], [1.4, 51.35], [0.9, 50.9], [-0.8, 50.75], [-1.9, 50.65], [-1.8, 51.0]]],
};
const LABEL_AT: Record<string, [number, number]> = {
  scot_north: [-4.2, 57.55], scot_central: [-4.0, 56.1], scot_south: [-3.4, 55.35], ni: [-6.8, 54.6], eng_north: [-1.9, 54.25],
  wales: [-3.8, 52.4], eng_mid: [-0.6, 52.6], eng_sw: [-3.4, 51.05], eng_se: [-0.2, 51.45],
};
const xy = ([lng, lat]: [number, number]) => [((lng + 8.7) * 34.4).toFixed(1), ((61 - lat) * 60).toFixed(1)];

export function RegionMap({ regions, counts, selected, onSelect }: { regions: { key: string; label: string }[]; counts: Record<string, number>; selected: string; onSelect: (key: string) => void }) {
  return (
    <svg viewBox="0 0 370 680" role="group" aria-label="Choose an area" className="h-auto w-full max-w-sm">
      {regions.map((r) => {
        const on = selected === r.key;
        const [lx, ly] = xy(LABEL_AT[r.key] ?? [0, 0]);
        return (
          <g key={r.key} role="button" tabIndex={0} aria-pressed={on} aria-label={`${r.label}: ${counts[r.key] ?? 0} firms`}
            onClick={() => onSelect(on ? '' : r.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(on ? '' : r.key); } }}
            className="group cursor-pointer outline-none">
            {(SHAPES[r.key] ?? []).map((poly, i) => (
              <polygon key={i} points={poly.map((p) => xy(p).join(',')).join(' ')}
                className={`stroke-background transition ${on ? 'fill-primary' : 'fill-primary/25 group-hover:fill-primary/45 group-focus-visible:fill-primary/45'}`} strokeWidth={2} strokeLinejoin="round" />
            ))}
            <text x={lx} y={ly} textAnchor="middle" className={`pointer-events-none text-[11px] font-medium ${on ? 'fill-primary-foreground' : 'fill-foreground'}`}>{r.label}</text>
            <text x={lx} y={Number(ly) + 13} textAnchor="middle" className={`pointer-events-none text-[10px] ${on ? 'fill-primary-foreground' : 'fill-muted-foreground'}`}>{(counts[r.key] ?? 0).toLocaleString()} firms</text>
          </g>
        );
      })}
    </svg>
  );
}
