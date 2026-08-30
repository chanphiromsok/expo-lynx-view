// Shared types + status color tokens for the BatchTracking screen.
// In a real app this would live alongside `shipmentTracking.ts` from the
// BSExpress host project — the Lynx side is the same shape.

export type TrackingStatusCode =
  | 'ready_for_dispatch'
  | 'in_transit'
  | 'arrived_at_hub'
  | 'ready_for_delivery'
  | 'non_delivered'
  | 'delivered'
  | 'delivered_at_counter'
  | 'cancelled'
  | 'assigned_to_manifest';

// ─────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────

export interface PieceRow {
  packageNumber: number;
  /** Latest tracking note. Hoisted to the section header when uniform
   *  across the whole status group, with per-row overrides rendered on
   *  individual rows. */
  notes?: string;
  /** Branch the package is currently at. Same hoisting rules as notes. */
  branch?: string;
  /** Weight in kg. Goes into the trailing line. */
  weight?: number;
  /** Whether the piece is Cash-On-Delivery. Goes into the trailing line. */
  cod?: boolean;
  statusCode: TrackingStatusCode;
  /** ISO-8601 timestamp of the latest tracking event. Hoisted when uniform. */
  updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// BatchDetail
// ─────────────────────────────────────────────────────────────────────────

export interface BatchDetail {
  invoiceNumber: string;
  receiver: {
    name: string;
    phone: string;
    address: string;
  };
  origin: { city: string; branch?: string };
  destination: { city: string; branch?: string };
  vehicle: string;
  updatedAt: string;
  parcelType?: string;
  serviceType?: string;
  isCod?: boolean;
  pieces: PieceRow[];
}

// ─────────────────────────────────────────────────────────────────────────
// Buckets — severity-ordered groups.
// ─────────────────────────────────────────────────────────────────────────

export type Bucket = 'delivered' | 'in_transit' | 'issues';

export const BUCKET_CODES: Record<Bucket, TrackingStatusCode[]> = {
  delivered: ['delivered', 'delivered_at_counter'],
  in_transit: [
    'assigned_to_manifest',
    'ready_for_dispatch',
    'in_transit',
    'arrived_at_hub',
    'ready_for_delivery',
  ],
  issues: ['non_delivered', 'cancelled'],
};

/** Single source of truth for "needs action". */
export const ATTENTION_CODES = BUCKET_CODES.issues;

/** Issues first, then in-flight, then done. */
export function severityOf(code: TrackingStatusCode): number {
  if (ATTENTION_CODES.includes(code)) return 0;
  return BUCKET_CODES.delivered.includes(code) ? 2 : 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Section builder — groups by status, hoists shared facts to the header.
// Mirrors BSExpress/userapp/src/screens/tracking/BatchTrackingDetailsScreen.model.ts
// ─────────────────────────────────────────────────────────────────────────

/** Per-piece detail/trailing. Both null = single-line row. */
export interface PieceRender {
  /** Per-piece note (or null if uniform across the group → hoisted). */
  detail: string | null;
  /** Per-piece trailing line ("branch · weight · COD · time"). */
  trailing: string | null;
}

export interface StatusSection {
  code: TrackingStatusCode;
  label: string;
  count: number;
  /** Lines printed under the section title — facts every piece shares. */
  sharedFacts: string[];
  data: PieceRender[];
}

// ────────────────────────────────────────────────────────────────────────
// English status labels — i18n wraps this on the production side.
// ────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TrackingStatusCode, string> = {
  ready_for_dispatch: 'Waiting',
  in_transit: 'In transit',
  arrived_at_hub: 'At hub',
  ready_for_delivery: 'Out for delivery',
  non_delivered: 'Failed',
  delivered: 'Delivered',
  delivered_at_counter: 'Counter',
  cancelled: 'Cancelled',
  assigned_to_manifest: 'Assigned',
};

// ────────────────────────────────────────────────────────────────────────
// Format helpers — turn fields into display strings. Locale-neutral.
// ────────────────────────────────────────────────────────────────────────

function fmtNotes(p: PieceRow): string | null {
  return p.notes ?? null;
}
function fmtBranch(p: PieceRow): string | null {
  return p.branch ?? null;
}
function fmtWeight(p: PieceRow): string | null {
  return p.weight != null ? `${p.weight} kg` : null;
}
function fmtCod(p: PieceRow): string | null {
  return p.cod ? 'COD' : null;
}

export function buildSections(pieces: PieceRow[]): StatusSection[] {
  const byCode = new Map<TrackingStatusCode, PieceRow[]>();
  for (const p of pieces) {
    const list = byCode.get(p.statusCode);
    if (list) list.push(p);
    else byCode.set(p.statusCode, [p]);
  }

  const ordered = Array.from(byCode.entries()).sort(([a, ga], [b, gb]) => {
    const diff = severityOf(a) - severityOf(b);
    return diff !== 0 ? diff : gb.length - ga.length;
  });

  return ordered.map(([code, group]) => {
    // Detect uniform facts across the group.
    const uniformNotes =
      new Set(group.map((p) => fmtNotes(p) ?? '')).size === 1;
    const uniformBranch =
      new Set(group.map((p) => fmtBranch(p) ?? '')).size === 1;
    const uniformUpdatedAt =
      new Set(group.map((p) => p.updatedAt ?? '')).size === 1;

    const sharedFacts: string[] = [];
    if (uniformNotes) {
      const v = fmtNotes(group[0]!);
      if (v) sharedFacts.push(v);
    }
    if (uniformBranch) {
      const v = fmtBranch(group[0]!);
      if (v) sharedFacts.push(v);
    }
    if (uniformUpdatedAt) {
      const v = group[0]!.updatedAt;
      if (v) sharedFacts.push(v);
    }

    return {
      code,
      label: STATUS_LABEL[code],
      count: group.length,
      sharedFacts,
      data: group.map((p) => {
        // Per-piece trailing: parts the header didn't hoist + weight + COD.
        const trailingParts: string[] = [];
        if (!uniformBranch) {
          const v = fmtBranch(p);
          if (v) trailingParts.push(v);
        }
        if (!uniformNotes) {
          const v = fmtNotes(p);
          if (v) trailingParts.push(v);
        }
        const w = fmtWeight(p);
        if (w) trailingParts.push(w);
        const c = fmtCod(p);
        if (c) trailingParts.push(c);
        if (!uniformUpdatedAt && p.updatedAt) {
          trailingParts.push(p.updatedAt);
        }

        // Detail = note (or null if uniform).
        const detail = !uniformNotes && p.notes ? p.notes : null;

        return {
          detail,
          trailing: trailingParts.length > 0 ? trailingParts.join(' · ') : null,
        };
      }),
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// 100-piece stub
// ────────────────────────────────────────────────────────────────────────

export const STUB_BATCH: BatchDetail = {
  invoiceNumber: 'INV260727086785',
  receiver: { name: 'Sok Pisey', phone: '017 426 000', address: 'ផ្សារត្រាំកក់' },
  origin: { city: 'Phnom Penh', branch: 'សាខាភ្នំពេញ' },
  destination: { city: 'Takeo', branch: 'សាខាតាកែវ' },
  vehicle: '3H-0907',
  updatedAt: '2026-07-27T05:26:50.000Z',
  parcelType: 'Document',
  serviceType: 'Standard Delivery',
  isCod: true,
  pieces: stubPieces(),
};

function stubPieces(): PieceRow[] {
  // Distribution: 2 non_delivered, 6 cancelled, 60 in_transit, 12 at-hub,
  // 4 ready_for_delivery, 21 delivered, 5 delivered_at_counter.
  // Designed so each status group has UNIFORM notes/branch/updatedAt —
  // which is exactly the shared-facts hoisting the production code wants.
  const out: PieceRow[] = [];
  for (let i = 1; i <= 100; i++) {
    let code: TrackingStatusCode;
    let notes: string | undefined;
    let branch: string;
    let updatedAt: string;

    if (i <= 2) {
      // Issues bucket — non_delivered. 2 pieces, SAME branch & same updatedAt
      // minute so the header can hoist both.
      code = 'non_delivered';
      notes = i === 1 ? 'Receiver unavailable' : 'Address incomplete';
      branch = 'Takeo Hub';
      updatedAt = '2026-07-27T05:21:00Z';
    } else if (i <= 8) {
      // Issues bucket — cancelled. 6 pieces, SAME branch, SAME minute.
      code = 'cancelled';
      notes = 'Cancelled by sender';
      branch = 'Phnom Penh Hub';
      updatedAt = '2026-07-27T05:18:00Z';
    } else if (i <= 70) {
      // In transit bucket — 60 in_transit + 12 arrived_at_hub interleaved.
      // Same branch across all, slightly different times per piece.
      code = i % 5 === 0 ? 'arrived_at_hub' : 'in_transit';
      branch = 'Takeo Hub';
      updatedAt = `2026-07-27T05:${String(10 + (i % 30)).padStart(2, '0')}:00Z`;
    } else if (i <= 95) {
      // Delivered bucket — 21 delivered + 4 delivered_at_counter.
      code = i % 7 === 0 ? 'delivered_at_counter' : 'delivered';
      branch = 'Takeo Hub';
      updatedAt = `2026-07-27T04:${String(10 + (i % 30)).padStart(2, '0')}:00Z`;
    } else {
      code = 'ready_for_delivery';
      branch = 'Siem Reap city';
      updatedAt = `2026-07-27T05:${String(10 + (i % 30)).padStart(2, '0')}:00Z`;
    }

    out.push({
      packageNumber: i,
      weight: 0.4 + (i % 13) * 0.1,
      cod: i % 4 !== 0,
      branch,
      notes,
      updatedAt,
      statusCode: code,
    });
  }
  return out;
}
