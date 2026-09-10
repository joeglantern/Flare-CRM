/**
 * The chart kit, imported as `@crm/ui/charts`.
 *
 * A separate entry point from the rest of the design system on purpose: only the owner console draws
 * charts, and this way the CRM does not carry the scale and shape code it never calls.
 *
 * Every chart in here is presentational. It takes numbers and returns a picture of them. It does no
 * fetching, knows no endpoints, and formats nothing itself, because how a figure is said depends on
 * whether it is seats, bytes or money, and only the screen knows which.
 */
export { BarChart, type BarSeries } from './BarChart.js';
export {
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  CountUp,
  type ChartDelta,
  type ChartTable,
  type LegendItem,
} from './ChartFrame.js';
export { EventTimeline, type TimelineEvent } from './EventTimeline.js';
export { HeatStrip, type HeatDay } from './HeatStrip.js';
export { RingStat, type RingSlice } from './RingStat.js';
export { Sparkline } from './Sparkline.js';
export { TrendChart, type TrendSeries } from './TrendChart.js';
export {
  ink,
  MAX_SERIES,
  motion as chartMotion,
  SERIES_COLORS,
  seriesColor,
  usePrefersReducedMotion,
  type ChartPoint,
} from './style.js';
