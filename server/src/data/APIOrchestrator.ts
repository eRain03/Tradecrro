import TigerClient from './TigerClient';
import YahooFinanceClient from './YahooFinanceClient';
import config from '../config';

export type DataSource = 'tiger' | 'yahoo' | 'simulated';

export interface DataSourceStatus {
  name: DataSource;
  available: boolean;
  lastError?: string;
  lastErrorTime?: Date;
  pausedUntil?: Date;
  requestCount: number;
  errorCount: number;
}

/**
 * API Orchestrator
 * Manages automatic failover between data sources
 *
 * Features:
 * - Automatic failover when Tiger API is rate-limited or unavailable
 * - Automatic recovery when Tiger API becomes available again
 * - Health monitoring for each data source
 * - Cooldown period after rate limit errors
 */
class APIOrchestrator {
  private tigerClient: TigerClient | null = null;
  private yahooClient: YahooFinanceClient | null = null;

  private primarySource: DataSource;
  private currentSource: DataSource;
  private fallbackSource: DataSource;

  private status: Map<DataSource, DataSourceStatus> = new Map();

  // Cooldown duration after rate limit error (5 minutes)
  private readonly rateLimitCooldownMs = 5 * 60 * 1000;
  // Check interval for Tiger recovery (30 seconds)
  private readonly recoveryCheckIntervalMs = 30 * 1000;
  // Max consecutive errors before marking source as unavailable
  private readonly maxConsecutiveErrors = 3;

  private recoveryCheckTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.primarySource = config.dataSource.provider as DataSource;
    this.currentSource = this.primarySource;
    this.fallbackSource = 'yahoo';

    // Initialize status for all sources
    this.status.set('tiger', {
      name: 'tiger',
      available: true,
      requestCount: 0,
      errorCount: 0,
    });
    this.status.set('yahoo', {
      name: 'yahoo',
      available: true,
      requestCount: 0,
      errorCount: 0,
    });

    // Initialize clients based on config
    if (this.primarySource === 'tiger') {
      this.tigerClient = new TigerClient();
      this.yahooClient = new YahooFinanceClient();
      console.log('🔄 API Orchestrator: Primary=Tiger, Fallback=Yahoo');
    } else if (this.primarySource === 'yahoo') {
      this.yahooClient = new YahooFinanceClient();
      console.log('🔄 API Orchestrator: Primary=Yahoo (no fallback)');
    }

    // Start recovery check if using Tiger
    if (this.primarySource === 'tiger') {
      this.startRecoveryCheck();
    }
  }

  /**
   * Get current active data source
   */
  getCurrentSource(): DataSource {
    return this.currentSource;
  }

  /**
   * Check if currently using fallback
   */
  isUsingFallback(): boolean {
    return this.currentSource !== this.primarySource;
  }

  /**
   * Get status of all data sources
   */
  getStatus(): Record<DataSource, DataSourceStatus> {
    const result: Record<DataSource, DataSourceStatus> = {} as any;
    this.status.forEach((s, k) => {
      result[k] = { ...s };
    });
    return result;
  }

  /**
   * Get Tiger client (may be null if unavailable)
   */
  getTigerClient(): TigerClient | null {
    return this.tigerClient;
  }

  /**
   * Get Yahoo client
   */
  getYahooClient(): YahooFinanceClient {
    return this.yahooClient!;
  }

  /**
   * Check if Tiger is available
   */
  isTigerAvailable(): boolean {
    const tigerStatus = this.status.get('tiger')!;
    const now = new Date();

    // Check if paused due to rate limit
    if (tigerStatus.pausedUntil && tigerStatus.pausedUntil > now) {
      return false;
    }

    // Check if client is safe (not blacklisted)
    if (this.tigerClient && !this.tigerClient.isSafe()) {
      return false;
    }

    // Check if in rate limit pause
    if (this.tigerClient && this.tigerClient.isInRateLimitPause()) {
      return false;
    }

    return tigerStatus.available;
  }

  /**
   * Execute a request with automatic failover
   */
  async executeWithFailover<T>(
    operation: 'quote' | 'quotes' | 'historical',
    tigerOperation: () => Promise<T>,
    yahooOperation: () => Promise<T>,
    symbol?: string
  ): Promise<T> {
    // If using fallback, try to recover to primary first
    if (this.isUsingFallback() && this.primarySource === 'tiger') {
      await this.attemptRecovery();
    }

    // If Tiger is primary and available, use it
    if (this.primarySource === 'tiger' && this.isTigerAvailable()) {
      try {
        const result = await tigerOperation();
        this.recordSuccess('tiger');
        return result;
      } catch (error: any) {
        this.recordError('tiger', error);

        // Check if should failover
        if (this.shouldFailover(error)) {
          console.log(`⚠️ [API Orchestrator] Tiger API error, switching to Yahoo fallback`);
          console.log(`   Error: ${error.message?.slice(0, 100)}`);
          this.switchToFallback();
          return yahooOperation();
        }

        throw error;
      }
    }

    // Use Yahoo (fallback or primary)
    try {
      const result = await yahooOperation();
      this.recordSuccess('yahoo');
      return result;
    } catch (error: any) {
      this.recordError('yahoo', error);
      throw error;
    }
  }

  /**
   * Check if should failover based on error
   */
  private shouldFailover(error: any): boolean {
    const errorMsg = error.message?.toLowerCase() || '';

    // Rate limit errors - definitely failover
    const rateLimitKeywords = [
      'rate limit',
      'too many requests',
      'code=4',
      'current limiting',
      'frequency limit',
      'blacklist threat',
      'disabled due to',
      'temporarily paused',
    ];

    for (const keyword of rateLimitKeywords) {
      if (errorMsg.includes(keyword)) {
        return true;
      }
    }

    // Connection errors - failover
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Check consecutive errors
    const tigerStatus = this.status.get('tiger')!;
    if (tigerStatus.errorCount >= this.maxConsecutiveErrors) {
      return true;
    }

    return false;
  }

  /**
   * Switch to fallback data source
   */
  private switchToFallback(): void {
    if (this.currentSource === this.fallbackSource) {
      return;
    }

    console.log(`🔄 [API Orchestrator] Switching from ${this.currentSource} to ${this.fallbackSource}`);
    this.currentSource = this.fallbackSource;

    // Set cooldown for Tiger
    const tigerStatus = this.status.get('tiger')!;
    tigerStatus.pausedUntil = new Date(Date.now() + this.rateLimitCooldownMs);
    tigerStatus.available = false;

    console.log(`⏳ [API Orchestrator] Tiger paused for ${this.rateLimitCooldownMs / 60000} minutes`);
  }

  /**
   * Attempt to recover to primary source
   */
  private async attemptRecovery(): Promise<void> {
    if (this.primarySource !== 'tiger') {
      return;
    }

    const tigerStatus = this.status.get('tiger')!;
    const now = new Date();

    // Check if cooldown has passed
    if (tigerStatus.pausedUntil && tigerStatus.pausedUntil > now) {
      return;
    }

    // Check if client is safe
    if (!this.tigerClient || !this.tigerClient.isSafe()) {
      return;
    }

    // Check if still in rate limit pause
    if (this.tigerClient.isInRateLimitPause()) {
      return;
    }

    // Try a simple health check
    try {
      console.log('🔍 [API Orchestrator] Checking Tiger API health...');

      // Use a common stock for health check
      await this.tigerClient.getQuote('AAPL');

      // Success! Switch back to Tiger
      console.log('✅ [API Orchestrator] Tiger API recovered, switching back from Yahoo');
      this.currentSource = 'tiger';
      tigerStatus.available = true;
      tigerStatus.pausedUntil = undefined;
      tigerStatus.errorCount = 0;
      tigerStatus.lastError = undefined;
    } catch (error: any) {
      console.log(`❌ [API Orchestrator] Tiger API still unavailable: ${error.message?.slice(0, 50)}`);
      // Extend cooldown
      tigerStatus.pausedUntil = new Date(Date.now() + this.rateLimitCooldownMs);
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(source: DataSource): void {
    const status = this.status.get(source)!;
    status.requestCount++;
    status.errorCount = 0; // Reset consecutive errors
  }

  /**
   * Record error
   */
  private recordError(source: DataSource, error: any): void {
    const status = this.status.get(source)!;
    status.errorCount++;
    status.lastError = error.message?.slice(0, 200);
    status.lastErrorTime = new Date();

    console.error(`❌ [API Orchestrator] ${source} error (${status.errorCount} consecutive): ${status.lastError?.slice(0, 100)}`);
  }

  /**
   * Start periodic recovery check
   */
  private startRecoveryCheck(): void {
    if (this.recoveryCheckTimer) {
      clearInterval(this.recoveryCheckTimer);
    }

    this.recoveryCheckTimer = setInterval(() => {
      if (this.isUsingFallback()) {
        this.attemptRecovery();
      }
    }, this.recoveryCheckIntervalMs);

    console.log(`🔄 [API Orchestrator] Recovery check started (every ${this.recoveryCheckIntervalMs / 1000}s)`);
  }

  /**
   * Stop recovery check
   */
  stopRecoveryCheck(): void {
    if (this.recoveryCheckTimer) {
      clearInterval(this.recoveryCheckTimer);
      this.recoveryCheckTimer = null;
    }
  }

  /**
   * Force switch to a specific source
   */
  forceSwitch(source: DataSource): void {
    console.log(`🔄 [API Orchestrator] Force switching to ${source}`);
    this.currentSource = source;

    if (source === 'tiger') {
      const tigerStatus = this.status.get('tiger')!;
      tigerStatus.available = true;
      tigerStatus.pausedUntil = undefined;
      tigerStatus.errorCount = 0;
    }
  }

  /**
   * Manually trigger recovery check
   */
  async checkRecovery(): Promise<boolean> {
    if (!this.isUsingFallback()) {
      return true; // Already on primary
    }

    await this.attemptRecovery();
    return !this.isUsingFallback();
  }
}

// Singleton instance
export const apiOrchestrator = new APIOrchestrator();

export default apiOrchestrator;