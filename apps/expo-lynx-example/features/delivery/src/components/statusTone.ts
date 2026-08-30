// Maps each tracking status code to a tone name used in the BatchTracking
// CSS classes (`.bt-status-dot--{tone}`, `.bt-seg--{tone}`).
//
// Tones match the iOS prototype:
//   - Issues bucket          → warn
//   - In transit (5 codes)   → accent
//   - Delivered (2 codes)    → success
//   - Other / fallback       → muted
//
// Keep in sync with `STATUS_PILL_LABEL` in the screen and with the
// shipmentTracking.ts STATUS_TONE map in BSExpress.

import type { TrackingStatusCode } from '../data/batch';

export const STATUS_TONE: Record<TrackingStatusCode, 'warn' | 'accent' | 'success' | 'muted'> = {
  ready_for_dispatch: 'muted',
  in_transit: 'accent',
  arrived_at_hub: 'accent',
  ready_for_delivery: 'accent',
  non_delivered: 'warn',
  delivered: 'success',
  delivered_at_counter: 'muted',
  cancelled: 'warn',
  assigned_to_manifest: 'accent',
};
