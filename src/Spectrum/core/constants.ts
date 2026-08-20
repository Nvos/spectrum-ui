/** Absolute minimum valid power reading (dBm). */
export const POWER_FLOOR = -110;

/** Absolute maximum valid power reading (dBm). */
export const POWER_CEILING = 30;

/** Sentinel value stored in a bin that has received no readings. */
export const POWER_NO_READING = -128;

/**
 * Retained history depth `N`, in rows. Fixed — deliberately not derived from
 * `binCount`. A power-of-two multiple of the future backend page size so ring
 * slots map cleanly onto pages.
 *
 * Distinct from the *displayed* row count `D`, which is the waterfall canvas
 * height in CSS pixels (1 row per pixel) and lives on `TimeCursor`.
 */
export const HISTORY_ROWS = 4096;

/**
 * Ceiling on simultaneous frequency lanes.
 *
 * Each lane owns one WebGL context, as each subview did. Browsers cap live
 * contexts (Chrome around 16) and silently drop the oldest past the cap, which
 * presents as an unrelated pane going black rather than as an error. The real
 * fix is rendering every pane into one canvas via `gl.viewport`/`gl.scissor`,
 * for which adjacent full-height columns are the natural case; until then, cap.
 */
export const MAX_LANES = 6;
