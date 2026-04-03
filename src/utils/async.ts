/**
 * Async utilities for the Marjin agent pipeline.
 * Provides timeout wrappers for Firebase queries to prevent
 * stuck requests from blocking the entire pipeline.
 */

import { logger } from "./logging.js";

/** Default timeout for critical data sources (daily metrics) */
export const TIMEOUT_CRITICAL_MS = 8000;

/** Default timeout for secondary data sources (hourly, labor, products, purchases) */
export const TIMEOUT_SECONDARY_MS = 5000;

/**
 * Wraps a promise with a timeout. If the promise does not resolve
 * within the given time, the returned promise rejects with a
 * descriptive error. The original promise is NOT cancelled (Firebase
 * does not support cancellation), but its result is ignored.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.warn(`Timeout after ${ms}ms: ${label}`);
      reject(new Error(`Timeout after ${ms}ms: ${label}`));
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
