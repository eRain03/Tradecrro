/**
 * API Rate Limit Monitor
 * Tracks Tiger Open API usage and warns when approaching limits
 *
 * Tiger API Rate Limits:
 * - High-frequency (quotes, timeline): 120/min
 * - Medium-frequency (bars, depth): 60/min
 * - Low-frequency (grab_quote_permission): 10/min
 *
 * We use CONSERVATIVE limits for safety:
 * - High-frequency: 100/min (83% of 120)
 * - Others: 50% of actual
 */

export interface RateLimitConfig {
  name: string;
  maxPerMinute: number;      // Tiger's actual limit
  safeLimit: number;         // Our conservative limit (50%)
  warningThreshold: number;  // Percentage to start warning (e.g., 0.7 = 70%)
  dangerThreshold: number;   // Percentage to start danger warning
}

export interface RateLimitStatus {
  name: string;
  current: number;
  max: number;
  safeLimit: number;
  percentage: number;
  status: 'safe' | 'warning' | 'danger' | 'critical';
  remaining: number;
  windowStart: Date;
}

export const TIGER_API_LIMITS: Record<string, RateLimitConfig> = {
  high_frequency: {
    name: 'High-Frequency API',
    maxPerMinute: 120,
    safeLimit: 100,
    warningThreshold: 0.7,  // 70% = 70 calls
    dangerThreshold: 0.9,   // 90% = 90 calls
  },
  medium_frequency: {
    name: 'Medium-Frequency API',
    maxPerMinute: 60,
    safeLimit: 30,
    warningThreshold: 0.7,
    dangerThreshold: 0.9,
  },
  low_frequency: {
    name: 'Low-Frequency API',
    maxPerMinute: 10,
    safeLimit: 5,
    warningThreshold: 0.6,
    dangerThreshold: 0.8,
  },
};

class RateLimitMonitor {
  private callTimestamps: Map<string, number[]> = new Map();
  private readonly windowMs = 60000; // 60 second sliding window

  /**
   * Record an API call
   */
  recordCall(apiType: keyof typeof TIGER_API_LIMITS): void {
    const now = Date.now();
    const timestamps = this.callTimestamps.get(apiType) || [];

    // Add current timestamp
    timestamps.push(now);

    // Remove timestamps outside the window
    const filtered = timestamps.filter(ts => now - ts < this.windowMs);
    this.callTimestamps.set(apiType, filtered);
  }

  /**
   * Get current call count for an API type
   */
  getCallCount(apiType: keyof typeof TIGER_API_LIMITS): number {
    const now = Date.now();
    const timestamps = this.callTimestamps.get(apiType) || [];

    // Filter to current window
    const filtered = timestamps.filter(ts => now - ts < this.windowMs);
    this.callTimestamps.set(apiType, filtered);

    return filtered.length;
  }

  /**
   * Get status for an API type
   */
  getStatus(apiType: keyof typeof TIGER_API_LIMITS): RateLimitStatus {
    const config = TIGER_API_LIMITS[apiType];
    const current = this.getCallCount(apiType);
    const percentage = current / config.safeLimit;

    let status: 'safe' | 'warning' | 'danger' | 'critical';
    if (percentage >= 1) {
      status = 'critical';
    } else if (percentage >= config.dangerThreshold) {
      status = 'danger';
    } else if (percentage >= config.warningThreshold) {
      status = 'warning';
    } else {
      status = 'safe';
    }

    // Find window start (oldest timestamp in window)
    const timestamps = this.callTimestamps.get(apiType) || [];
    const windowStart = timestamps.length > 0
      ? new Date(Math.min(...timestamps))
      : new Date();

    return {
      name: config.name,
      current,
      max: config.maxPerMinute,
      safeLimit: config.safeLimit,
      percentage: Math.round(percentage * 100),
      status,
      remaining: Math.max(0, config.safeLimit - current),
      windowStart,
    };
  }

  /**
   * Get all API statuses
   */
  getAllStatuses(): Record<string, RateLimitStatus> {
    const statuses: Record<string, RateLimitStatus> = {};

    for (const apiType of Object.keys(TIGER_API_LIMITS)) {
      statuses[apiType] = this.getStatus(apiType as keyof typeof TIGER_API_LIMITS);
    }

    return statuses;
  }

  /**
   * Check if we should throttle calls
   */
  shouldThrottle(apiType: keyof typeof TIGER_API_LIMITS): boolean {
    const status = this.getStatus(apiType);
    return status.status === 'danger' || status.status === 'critical';
  }

  /**
   * Get overall system health
   */
  getSystemHealth(): {
    status: 'healthy' | 'warning' | 'danger';
    message: string;
    details: RateLimitStatus[];
  } {
    const statuses = Object.values(this.getAllStatuses());

    const criticalCount = statuses.filter(s => s.status === 'critical').length;
    const dangerCount = statuses.filter(s => s.status === 'danger').length;
    const warningCount = statuses.filter(s => s.status === 'warning').length;

    if (criticalCount > 0) {
      return {
        status: 'danger',
        message: `${criticalCount} API type(s) at critical limit!`,
        details: statuses,
      };
    }

    if (dangerCount > 0) {
      return {
        status: 'danger',
        message: `${dangerCount} API type(s) approaching limit`,
        details: statuses,
      };
    }

    if (warningCount > 0) {
      return {
        status: 'warning',
        message: `${warningCount} API type(s) in warning zone`,
        details: statuses,
      };
    }

    return {
      status: 'healthy',
      message: 'All API usage within safe limits',
      details: statuses,
    };
  }

  /**
   * Reset all counters (for testing)
   */
  reset(): void {
    this.callTimestamps.clear();
  }
}

// Singleton instance
export const rateLimitMonitor = new RateLimitMonitor();

export default rateLimitMonitor;