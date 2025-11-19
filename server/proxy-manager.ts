/**
 * Proxy Manager for IP Rotation
 * 
 * Manages a pool of proxy servers for rotating IP addresses during scraping.
 * Supports proxy health checks, automatic failover, and round-robin rotation.
 */

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: 'http' | 'https' | 'socks5';
}

export interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsed: Date | null;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  isHealthy: boolean;
}

export class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;
  private stats: Map<string, ProxyStats> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly maxFailures = 3; // Max consecutive failures before marking unhealthy
  private readonly healthCheckIntervalMs = 60000; // 1 minute

  constructor(proxies: ProxyConfig[] = []) {
    this.proxies = proxies;
    this.initializeStats();
  }

  /**
   * Initialize statistics for all proxies
   */
  private initializeStats(): void {
    for (const proxy of this.proxies) {
      const key = this.getProxyKey(proxy);
      this.stats.set(key, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastUsed: null,
        lastSuccess: null,
        lastFailure: null,
        isHealthy: true,
      });
    }
  }

  /**
   * Add a proxy to the pool
   */
  addProxy(proxy: ProxyConfig): void {
    this.proxies.push(proxy);
    const key = this.getProxyKey(proxy);
    if (!this.stats.has(key)) {
      this.stats.set(key, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastUsed: null,
        lastSuccess: null,
        lastFailure: null,
        isHealthy: true,
      });
    }
  }

  /**
   * Get the next available healthy proxy in rotation
   */
  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null;
    }

    // Try to find a healthy proxy
    const startIndex = this.currentIndex;
    let attempts = 0;

    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      const stats = this.stats.get(this.getProxyKey(proxy));

      // Move to next proxy for next request
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      attempts++;

      // Return this proxy if it's healthy
      if (stats?.isHealthy) {
        stats.lastUsed = new Date();
        stats.totalRequests++;
        return proxy;
      }
    }

    // If no healthy proxies found, return the next one anyway (degraded mode)
    console.warn('[ProxyManager] No healthy proxies available, using degraded mode');
    const proxy = this.proxies[startIndex];
    const stats = this.stats.get(this.getProxyKey(proxy));
    if (stats) {
      stats.lastUsed = new Date();
      stats.totalRequests++;
    }
    return proxy;
  }

  /**
   * Mark a proxy request as successful
   */
  recordSuccess(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy);
    const stats = this.stats.get(key);
    if (stats) {
      stats.successfulRequests++;
      stats.lastSuccess = new Date();
      stats.failedRequests = 0; // Reset failure counter
      stats.isHealthy = true;
    }
  }

  /**
   * Mark a proxy request as failed
   */
  recordFailure(proxy: ProxyConfig): void {
    const key = this.getProxyKey(proxy);
    const stats = this.stats.get(key);
    if (stats) {
      stats.failedRequests++;
      stats.lastFailure = new Date();

      // Mark as unhealthy if too many consecutive failures
      if (stats.failedRequests >= this.maxFailures) {
        stats.isHealthy = false;
        console.warn(`[ProxyManager] Proxy ${key} marked as unhealthy after ${stats.failedRequests} failures`);
      }
    }
  }

  /**
   * Get statistics for a specific proxy
   */
  getProxyStats(proxy: ProxyConfig): ProxyStats | undefined {
    return this.stats.get(this.getProxyKey(proxy));
  }

  /**
   * Get statistics for all proxies
   */
  getAllStats(): Map<string, ProxyStats> {
    return new Map(this.stats);
  }

  /**
   * Get all healthy proxies
   */
  getHealthyProxies(): ProxyConfig[] {
    return this.proxies.filter(proxy => {
      const stats = this.stats.get(this.getProxyKey(proxy));
      return stats?.isHealthy ?? true;
    });
  }

  /**
   * Get count of available proxies
   */
  getProxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Get count of healthy proxies
   */
  getHealthyProxyCount(): number {
    return this.getHealthyProxies().length;
  }

  /**
   * Format proxy as a connection string for Puppeteer
   */
  formatProxyUrl(proxy: ProxyConfig): string {
    const protocol = proxy.protocol || 'http';
    if (proxy.username && proxy.password) {
      return `${protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    }
    return `${protocol}://${proxy.host}:${proxy.port}`;
  }

  /**
   * Format proxy for Puppeteer args (--proxy-server format)
   */
  formatProxyServerArg(proxy: ProxyConfig): string {
    const protocol = proxy.protocol || 'http';
    return `${protocol}=${proxy.host}:${proxy.port}`;
  }

  /**
   * Get a unique key for a proxy configuration
   */
  private getProxyKey(proxy: ProxyConfig): string {
    return `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`;
  }

  /**
   * Reset all proxy statistics
   */
  resetStats(): void {
    Array.from(this.stats.entries()).forEach(([key, stats]) => {
      stats.totalRequests = 0;
      stats.successfulRequests = 0;
      stats.failedRequests = 0;
      stats.lastUsed = null;
      stats.lastSuccess = null;
      stats.lastFailure = null;
      stats.isHealthy = true;
    });
  }

  /**
   * Manually mark a proxy as healthy or unhealthy
   */
  setProxyHealth(proxy: ProxyConfig, isHealthy: boolean): void {
    const key = this.getProxyKey(proxy);
    const stats = this.stats.get(key);
    if (stats) {
      stats.isHealthy = isHealthy;
      if (isHealthy) {
        stats.failedRequests = 0; // Reset failure counter
      }
    }
  }

  /**
   * Start periodic health checks for all proxies
   */
  startHealthChecks(intervalMs: number = this.healthCheckIntervalMs): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);

    console.log(`[ProxyManager] Health checks started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[ProxyManager] Health checks stopped');
    }
  }

  /**
   * Perform health checks on all proxies
   */
  private async performHealthChecks(): Promise<void> {
    console.log('[ProxyManager] Running health checks...');
    
    for (const proxy of this.proxies) {
      const isHealthy = await this.checkProxyHealth(proxy);
      this.setProxyHealth(proxy, isHealthy);
    }

    const healthyCount = this.getHealthyProxyCount();
    console.log(`[ProxyManager] Health check complete: ${healthyCount}/${this.proxies.length} proxies healthy`);
  }

  /**
   * Check if a specific proxy is healthy
   * This is a basic connectivity test - can be enhanced with actual HTTP requests
   */
  private async checkProxyHealth(proxy: ProxyConfig): Promise<boolean> {
    try {
      // Basic connectivity test
      // In production, you might want to make an actual HTTP request through the proxy
      // For now, we'll assume proxies are healthy unless they've failed too many times
      const stats = this.stats.get(this.getProxyKey(proxy));
      if (!stats) return true;

      // If it hasn't been used recently and has failures, mark as potentially unhealthy
      const hoursSinceLastUse = stats.lastUsed 
        ? (Date.now() - stats.lastUsed.getTime()) / (1000 * 60 * 60)
        : 999;

      if (hoursSinceLastUse > 1 && stats.failedRequests > 0) {
        // Reset failure count for stale proxies to give them another chance
        stats.failedRequests = 0;
        return true;
      }

      return stats.failedRequests < this.maxFailures;
    } catch (error) {
      console.error(`[ProxyManager] Health check failed for ${this.getProxyKey(proxy)}:`, error);
      return false;
    }
  }

  /**
   * Load proxies from environment variables
   * Expected format: PROXY_LIST="http://user:pass@host1:port1,https://host2:port2"
   */
  static fromEnvironment(): ProxyManager {
    const proxyList = process.env.PROXY_LIST || '';
    const proxies: ProxyConfig[] = [];

    if (!proxyList) {
      console.log('[ProxyManager] No proxy list found in environment');
      return new ProxyManager(proxies);
    }

    const proxyStrings = proxyList.split(',').map(s => s.trim()).filter(Boolean);
    
    for (const proxyString of proxyStrings) {
      try {
        const proxy = ProxyManager.parseProxyString(proxyString);
        if (proxy) {
          proxies.push(proxy);
        }
      } catch (error) {
        console.error(`[ProxyManager] Failed to parse proxy: ${proxyString}`, error);
      }
    }

    console.log(`[ProxyManager] Loaded ${proxies.length} proxies from environment`);
    return new ProxyManager(proxies);
  }

  /**
   * Parse a proxy string into a ProxyConfig
   * Supported formats:
   * - http://host:port
   * - http://user:pass@host:port
   * - https://host:port
   * - socks5://host:port
   */
  static parseProxyString(proxyString: string): ProxyConfig | null {
    try {
      const url = new URL(proxyString);
      
      const config: ProxyConfig = {
        host: url.hostname,
        port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
        protocol: url.protocol.replace(':', '') as 'http' | 'https' | 'socks5',
      };

      if (url.username) {
        config.username = decodeURIComponent(url.username);
      }
      if (url.password) {
        config.password = decodeURIComponent(url.password);
      }

      return config;
    } catch (error) {
      console.error(`[ProxyManager] Invalid proxy string: ${proxyString}`, error);
      return null;
    }
  }
}

// Singleton instance
let proxyManagerInstance: ProxyManager | null = null;

/**
 * Get or create the global proxy manager instance
 */
export function getProxyManager(): ProxyManager {
  if (!proxyManagerInstance) {
    proxyManagerInstance = ProxyManager.fromEnvironment();
  }
  return proxyManagerInstance;
}

/**
 * Reset the global proxy manager instance
 */
export function resetProxyManager(): void {
  if (proxyManagerInstance) {
    proxyManagerInstance.stopHealthChecks();
    proxyManagerInstance = null;
  }
}
