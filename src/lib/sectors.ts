// The one list of sectors, used everywhere: Discover's tickboxes and Sources pop-ups, Shortlist tags and filter, the
// Search terms table and every source read. Firms and sources store the key; people see the label (Shortlist tags
// are labels). Add or rename a sector here only; nothing else keeps its own list.
export const SECTOR_LIST = [
  { key: 'engineering', label: 'Civil & structural engineering design', aliases: ['engineering'] },
  { key: 'architecture', label: 'Architecture', aliases: [] },
  { key: 'planning', label: 'Town/urban planning & landscape architecture', aliases: ['town/urban planning', 'landscape architecture', 'planning'] },
  { key: 'surveying', label: 'Testing, surveying & other technical', aliases: [] },
  { key: 'surveyor', label: 'Surveyors', aliases: ['surveyor'] },
  { key: 'civil_contractor', label: 'Civil engineering contractors', aliases: [] },
  { key: 'builder', label: 'Building & specialist contractors', aliases: [] },
  { key: 'conservation', label: 'Conservation', aliases: [] },
  { key: 'forestry', label: 'Forestry', aliases: [] },
  { key: 'humanitarian', label: 'Humanitarian & development', aliases: ['humanitarian'] },
  { key: 'gis', label: 'GIS, LiDAR & geospatial survey', aliases: ['gis & lidar', 'gis', 'lidar'] },
  { key: 'misc', label: 'Miscellaneous', aliases: ['misc'] },
] as const;

export type SectorKey = (typeof SECTOR_LIST)[number]['key'];
export const SECTOR_KEYS = SECTOR_LIST.map((s) => s.key) as SectorKey[];
export const SECTORS = Object.fromEntries(SECTOR_LIST.map((s) => [s.key, s.label])) as Record<SectorKey, string>;
export const isSectorKey = (k: string): k is SectorKey => (SECTOR_KEYS as string[]).includes(k);

/** The sector a key, label or older tag name refers to ("Engineering", "GIS & LiDAR", "Surveyors", "planning"...), else null. */
export function sectorKeyOf(text: string): SectorKey | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = SECTOR_LIST.find((s) => s.key === t || s.label.toLowerCase() === t || (s.aliases as readonly string[]).includes(t));
  return hit ? hit.key : null;
}
