/**
 * Alpha applied to all-time accumulator overlays (avg / max / maxSnapshot /
 * occupancy) while the view is scrolled back through history.
 *
 * Those layers are all-time accumulators and cannot describe a historical
 * window, so drawing them at full strength over a frozen waterfall would read
 * as a measurement of what is on screen. Dimming makes them read as context;
 * the follow/pause indicator carries the explicit signal. The accumulators keep
 * accumulating underneath, so returning to live is exact.
 */
export const SCROLLED_OVERLAY_ALPHA = 0.32;
