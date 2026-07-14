// Type declarations for the runtime module lib/analytics/sources.js.
// Upstream fetchers return structured feature objects (or throw { source, reason }).
// Only real runtime exports are declared. Optional upstreams resolve to null.

export interface BeecommDaily {
  revenue_total: number | null;
  tickets: number | null;
  revenue_dine_in: number | null;
  revenue_delivery: number | null;
  revenue_takeaway: number | null;
  /** Hour bucket ("08".."21") → numeric revenue (always populated, 0 when missing). */
  hourly: Record<string, number>;
}

export interface TabitHours {
  total_hours: number | null;
}

export interface WeatherFeatures {
  rain_mm: number;
  is_rain_day: boolean;
  temp_avg: number;
  wind_avg: number;
}

export interface OrefAlerts {
  alert_count: number;
  alert_minutes: number;
  is_alert_day: boolean;
}

export interface CalendarFeatures {
  dow: number;
  weekend: boolean;
  month: number;
  holiday: boolean;
  holiday_eve: boolean;
  new_year_eve: boolean;
}

export function fetchBeecommDaily(date: string): Promise<BeecommDaily>;
export function fetchTabitHours(date: string): Promise<TabitHours | null>;
export function fetchWeather(date: string): Promise<WeatherFeatures>;
export function fetchOrefAlerts(date: string): Promise<OrefAlerts>;
export function buildCalendar(date: string): CalendarFeatures;
