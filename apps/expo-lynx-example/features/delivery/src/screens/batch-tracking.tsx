import { useGlobalProps, useMemo, useState } from '@lynx-js/react';
import { useNavigate, useParams } from 'react-router';

import BackButton from '../components/BackButton';
import { STATUS_TONE } from '../components/statusTone';
import type { BatchDetail, PieceRow, TrackingStatusCode } from '../data/batch';
import { buildSections } from '../data/batch';
import '../styles/batch-tracking.css';
import { formatUpdatedAt } from '../utils/date';

// Per-status pill label shown on each piece row.
const STATUS_PILL_LABEL: Record<TrackingStatusCode, string> = {
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

// Severity bucket order — Issues before In Transit before Delivered.
// Order matches the OpenDesign HTML mock (`screens/android-batch-tracking.html`).
type BucketKey = 'issues' | 'in_transit' | 'delivered';

const BUCKETS: Array<{
  key: BucketKey;
  title: string;
  chipLabel: string;
  tone: 'warn' | 'accent' | 'success';
  codes: TrackingStatusCode[];
}> = [
  {
    key: 'issues',
    title: 'Needs attention',
    chipLabel: 'Needs attention',
    tone: 'warn',
    codes: ['non_delivered', 'cancelled'],
  },
  {
    key: 'in_transit',
    title: 'In transit',
    chipLabel: 'In transit',
    tone: 'accent',
    codes: [
      'assigned_to_manifest',
      'ready_for_dispatch',
      'in_transit',
      'arrived_at_hub',
      'ready_for_delivery',
    ],
  },
  {
    key: 'delivered',
    title: 'Delivered',
    chipLabel: 'Delivered',
    tone: 'success',
    codes: ['delivered', 'delivered_at_counter'],
  },
];

const STUB_BATCH: BatchDetail = {
  invoiceNumber: 'INV260727086785',
  receiver: {
    name: 'Sok Pisey',
    phone: '017 426 000',
    address: 'ផ្សារត្រាំកក់',
  },
  origin: { city: 'Phnom Penh', branch: 'សាខាភ្នំពេញ' },
  destination: { city: 'Takeo', branch: 'សាខាតាកែវ' },
  vehicle: '3H-0907',
  updatedAt: '2026-07-27T05:26:50.000Z',
  parcelType: 'Document',
  serviceType: 'Standard Delivery',
  isCod: true,
  pieces: stubPieces(),
};

const BatchTrackingScreen = ({
  embeddedShipment,
}: { embeddedShipment?: BatchDetail } = {}) => {
  const params = useParams<{ id?: string }>();
  const nav = useNavigate();
  const safeArea = useGlobalProps() as {
    safeAreaTop?: number;
    safeAreaBottom?: number;
    safeAreaLeft?: number;
    safeAreaRight?: number;
  };

  // Stub data — real impl would fetch via useQuery against the API.
  const batch: BatchDetail = embeddedShipment ?? {
    ...STUB_BATCH,
    invoiceNumber: params.id ?? STUB_BATCH.invoiceNumber,
    pieces: stubPieces(),
  };

  const [filter, setFilter] = useState<'all' | BucketKey>('all');

  // Tally counts per bucket (computed once).
  const counts = useMemo(() => {
    const c = {
      all: batch.pieces.length,
      issues: 0,
      in_transit: 0,
      delivered: 0,
    };
    for (const p of batch.pieces) {
      const bucket = BUCKETS.find((b) => b.codes.includes(p.statusCode));
      if (bucket) c[bucket.key]++;
    }
    return c;
  }, [batch.pieces]);

  // Filter pieces.
  const filteredPieces = useMemo(() => {
    if (filter === 'all') return batch.pieces;
    const bucket = BUCKETS.find((b) => b.key === filter);
    return bucket
      ? batch.pieces.filter((p) => bucket.codes.includes(p.statusCode))
      : [];
  }, [batch.pieces, filter]);

  // Build sections via the production-parity model. `buildSections` groups
  // pieces by status code, severity-orders the groups, and hoists shared
  // notes/branch/time into the section header so each row only carries
  // what differs from the rest of the group.
  const sections = useMemo(
    () => buildSections(filteredPieces),
    [filteredPieces],
  );

  // Tally issue kinds ("Failed · Cancelled") for the attention strip.
  const issueKinds = useMemo(() => {
    const failed = batch.pieces.filter(
      (p) => p.statusCode === 'non_delivered',
    ).length;
    const cancelled = batch.pieces.filter(
      (p) => p.statusCode === 'cancelled',
    ).length;
    return { failed, cancelled };
  }, [batch.pieces]);

  // Track scroll position to show/hide the FAB.
  const [showFab, setShowFab] = useState(false);
  const onScroll = (e: { detail: { scrollTop: number } }) => {
    setShowFab(e.detail.scrollTop > 600);
  };

  return (
    <scroll-view
      scroll-orientation="vertical"
      className="bt-scroll"
      bindscroll={onScroll}
      style={{
        paddingTop: `${safeArea.safeAreaTop ?? 0}px`,
        paddingBottom: `${safeArea.safeAreaBottom ?? 0}px`,
        paddingLeft: `${safeArea.safeAreaLeft ?? 0}px`,
        paddingRight: `${safeArea.safeAreaRight ?? 0}px`,
      }}
    >
      {/* <view className="bt-appbar">
        <BackButton />
        <text className="bt-appbar-title">{batch.invoiceNumber}</text>
        <view className="bt-appbar-spacer" />
      </view> */}

      {/* Hero — receiver-first */}
      <view className="bt-hero">
        <text className="bt-eyebrow">
          Batch ·{' '}
          <text className="bt-eyebrow-strong">
            {batch.pieces.length} pieces
          </text>
        </text>
        <text className="bt-hero-name">{batch.receiver.name}</text>

        <view className="bt-call-row">
          <view className="bt-call-chip">
            <text className="bt-call-chip-label">Call</text>
            <text className="bt-call-chip-num">{batch.receiver.phone}</text>
          </view>
          <text className="bt-hero-addr">{batch.receiver.address}</text>
        </view>

        {/* Inline route — city → arrow → city (matches the OpenDesign markup) */}
        <view className="bt-route-inline">
          <text className="bt-route-city">{batch.origin.city}</text>
          <text className="bt-route-arrow">→</text>
          <text className="bt-route-city">{batch.destination.city}</text>
        </view>

        {/* Hero summary — segmented bar + legend */}
        <SummaryBar
          total={batch.pieces.length}
          issues={counts.issues}
          inTransit={counts.in_transit}
          delivered={counts.delivered}
        />

        {/* Tags row — parcel type · service type · vehicle · COD */}
        <view className="bt-tags">
          {batch.parcelType ? <Tag>{batch.parcelType}</Tag> : null}
          {batch.serviceType ? <Tag>{batch.serviceType}</Tag> : null}
          <Tag tone="vehicle">{`Vehicle ${batch.vehicle}`}</Tag>
          {batch.isCod === true ? <Tag tone="cod">COD</Tag> : null}
          {batch.isCod === false ? <Tag tone="muted">No COD</Tag> : null}
        </view>
      </view>

      {/* Needs attention strip — only when issues > 0 */}
      {counts.issues > 0 && (
        <view className="bt-attention" bindtap={() => setFilter('issues')}>
          <view className="bt-attention-icon" />
          <view className="bt-attention-body">
            <text className="bt-attention-count">
              {counts.issues === 1
                ? '1 piece needs attention'
                : `${counts.issues} pieces need attention`}
            </text>
            <text className="bt-attention-desc">
              {[
                issueKinds.failed > 0 && `${issueKinds.failed} Failed`,
                issueKinds.cancelled > 0 && `${issueKinds.cancelled} Cancelled`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </text>
          </view>
          <view className="bt-attention-action">
            <text className="bt-attention-action-label">Review</text>
            <text className="bt-attention-action-arrow">›</text>
          </view>
        </view>
      )}

      {/* Freshness row */}
      <view className="bt-freshness">
        <text className="bt-freshness-label">
          Last updated{' '}
          <text className="bt-freshness-time">
            {formatUpdatedAt(batch.updatedAt)}
          </text>
        </text>
        <view
          className="bt-refresh"
          bindtap={() => {
            /* noop — would re-fetch in real impl */
          }}
        >
          <text className="bt-refresh-icon">↻</text>
          <text className="bt-refresh-label">Refresh</text>
        </view>
      </view>

      {/* Filter chips */}
      <view className="bt-chips">
        <Chip
          label={`All · ${counts.all}`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        {counts.issues > 0 && (
          <Chip
            label={`Needs attention · ${counts.issues}`}
            tone="warn"
            active={filter === 'issues'}
            onClick={() => setFilter('issues')}
          />
        )}
        {counts.in_transit > 0 && (
          <Chip
            label={`In transit · ${counts.in_transit}`}
            tone="accent"
            active={filter === 'in_transit'}
            onClick={() => setFilter('in_transit')}
          />
        )}
        {counts.delivered > 0 && (
          <Chip
            label={`Delivered · ${counts.delivered}`}
            tone="success"
            active={filter === 'delivered'}
            onClick={() => setFilter('delivered')}
          />
        )}
      </view>

      {/* Sections + piece rows */}
      <view className="bt-section-list">
        {sections.map((section) => {
          // `piece` is the original PieceRow from batch.pieces — looked up
          // by index since buildSections doesn't carry it through.
          const sectionPieces = filteredPieces.filter(
            (p) => p.statusCode === section.code,
          );
          return (
            <view key={section.code} className="bt-section">
              <view className="bt-section-header">
                <view
                  className={`bt-status-dot bt-status-dot--${STATUS_TONE[section.code] ?? 'muted'}`}
                />
                <view className="bt-section-header-text">
                  <view className="bt-section-header-row">
                    <text className="bt-section-title">{section.label}</text>
                    <text className="bt-section-count">{section.count}</text>
                  </view>
                  {section.sharedFacts.length > 0 && (
                    <text className="bt-section-shared">
                      {section.sharedFacts.join(' · ')}
                    </text>
                  )}
                </view>
              </view>
              {section.data.map((row, idx) => {
                const piece = sectionPieces[idx];
                if (!piece) return null;
                return (
                  <PieceRowView
                    key={piece.packageNumber}
                    piece={piece}
                    render={row}
                    last={idx === section.data.length - 1}
                    onPress={() => nav(`/batches`)}
                  />
                );
              })}
            </view>
          );
        })}

        {filteredPieces.length === 0 && (
          <view className="bt-empty">
            <text className="bt-empty-text">No pieces match this filter.</text>
          </view>
        )}
      </view>

      {/* Back-to-top FAB — visible only after scrolling 600px */}
      {showFab && (
        <view
          className="bt-fab"
          bindtap={() => /* scroll-to-top via native */ undefined}
        >
          <text className="bt-fab-arrow">↑</text>
        </view>
      )}

      <view className="bt-spacer-bottom" />
    </scroll-view>
  );
};

export default BatchTrackingScreen;

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Chip({
  label,
  active = false,
  tone = 'muted',
  onClick,
}: {
  label: string;
  active?: boolean;
  tone?: string;
  onClick: () => void;
}) {
  const cls = ['bt-chip'];
  if (active) cls.push('bt-chip--active');
  if (tone !== 'muted') cls.push(`bt-chip--${tone}`);
  return (
    <view className={cls.join(' ')} bindtap={onClick}>
      <text className="bt-chip-label">{label}</text>
    </view>
  );
}

function Tag({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'muted' | 'vehicle' | 'cod';
}) {
  return <text className={`bt-tag bt-tag--${tone}`}>{children}</text>;
}

function SummaryBar({
  total,
  issues,
  inTransit,
  delivered,
}: {
  total: number;
  issues: number;
  inTransit: number;
  delivered: number;
}) {
  if (total === 0) return null;
  const seg = (n: number, tone: string) =>
    n === 0 ? null : (
      <view
        className={`bt-seg bt-seg--${tone}`}
        style={{ width: `${(n / total) * 100}%` }}
      />
    );
  return (
    <view className="bt-summary">
      <view className="bt-summary-bar">
        {seg(issues, 'warn')}
        {seg(inTransit, 'accent')}
        {seg(delivered, 'success')}
      </view>
      <view className="bt-summary-legend">
        {issues > 0 && (
          <Legend n={issues} tone="warn" label="Needs attention" />
        )}
        {inTransit > 0 && (
          <Legend n={inTransit} tone="accent" label="In transit" />
        )}
        {delivered > 0 && (
          <Legend n={delivered} tone="success" label="Delivered" />
        )}
      </view>
    </view>
  );
}

function Legend({
  n,
  tone,
  label,
}: {
  n: number;
  tone: string;
  label: string;
}) {
  return (
    <view className="bt-legend-item">
      <view className={`bt-status-dot bt-status-dot--${tone}`} />
      <text className="bt-legend-num">{n}</text>
      <text className="bt-legend-label">{label}</text>
    </view>
  );
}

function PieceRowView({
  piece,
  render: rowRender,
  last,
  onPress,
}: {
  piece: PieceRow;
  render: import('../data/batch').PieceRender;
  last: boolean;
  onPress: () => void;
}) {
  // Production-parity rendering: the buildSections() model has already
  // hoisted shared notes/branch/time to the section header. The row only
  // carries what DIFFERS for this specific piece — `detail` (the per-piece
  // note) and `trailing` (branch · weight · COD). When the group is uniform
  // on those fields, both come back null and the row collapses to a single
  // line carrying only the invoice suffix.
  return (
    <view
      className={last ? 'bt-piece-row bt-piece-row--last' : 'bt-piece-row'}
      bindtap={onPress}
    >
      <view className="bt-piece-avatar">
        <text className="bt-piece-num">
          #{String(piece.packageNumber).padStart(2, '0')}
        </text>
      </view>
      <view className="bt-piece-body">
        {rowRender.detail && (
          <text className="bt-piece-title">{rowRender.detail}</text>
        )}
        {rowRender.trailing && (
          <text className="bt-piece-sub">{rowRender.trailing}</text>
        )}
      </view>
      <view className="bt-piece-status">
        <view
          className={`bt-status-dot bt-status-dot--${STATUS_TONE[piece.statusCode] ?? 'muted'}`}
        />
        <text className="bt-piece-status-label">
          {STATUS_PILL_LABEL[piece.statusCode] ?? piece.statusCode}
        </text>
      </view>
    </view>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stub data
// ─────────────────────────────────────────────────────────────────────────

function stubPieces(): PieceRow[] {
  // 100-piece stub matching the OpenDesign markup. ~2 issues, ~6 cancelled,
  // ~62 in-transit, ~25 delivered, ~5 misc.
  const out: PieceRow[] = [];
  for (let i = 1; i <= 100; i++) {
    let code: TrackingStatusCode;
    let notes: string | undefined;
    if (i <= 2) {
      code = 'non_delivered';
      notes = i === 1 ? 'Receiver unavailable' : 'Address incomplete';
    } else if (i <= 8) {
      code = 'cancelled';
      notes = `Cancelled by sender · ${10 + i}m ago`;
    } else if (i <= 70) {
      code = i % 5 === 0 ? 'arrived_at_hub' : 'in_transit';
      notes =
        i % 5 === 0 ? undefined : `On vehicle 3H-0907 · en route · ${i % 60}m`;
    } else if (i <= 95) {
      code = i % 7 === 0 ? 'delivered_at_counter' : 'delivered';
      notes =
        i % 7 === 0
          ? 'Collected at counter'
          : `Signed by Sok Pisey · ${i % 30}m ago`;
    } else {
      code = 'ready_for_delivery';
      notes = 'Out for delivery · 15m ETA';
    }

    out.push({
      packageNumber: i,
      weight: 0.4 + (i % 13) * 0.1,
      cod: i % 4 !== 0,
      branch: i % 5 === 0 ? 'Takeo Hub' : 'Phnom Penh Hub',
      notes,
      statusCode: code,
    });
  }
  return out;
}
