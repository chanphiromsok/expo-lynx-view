// Date / time formatting helpers shared across screens.

const KH_MONTHS = [
  'មករា',
  'កុម្ភៈ',
  'មីនា',
  'មេសា',
  'ឧសភា',
  'មិថុនា',
  'កក្កដា',
  'សីហា',
  'កញ្ញា',
  'តុលា',
  'វិច្ឆិកា',
  'ធ្នូ',
];

/** Format an ISO-8601 timestamp as "27 កក្កា, 12:26" (Khmer month abbreviation, 24-h clock). */
export function formatUpdatedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const day = String(d.getUTCDate());
  const month = KH_MONTHS[d.getUTCMonth()] ?? '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hh}:${mm}`;
}
