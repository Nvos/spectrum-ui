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
