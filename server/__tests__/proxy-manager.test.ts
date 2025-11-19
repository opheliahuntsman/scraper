/**
 * Tests for ProxyManager
 */

import { ProxyManager, ProxyConfig } from '../proxy-manager';

describe('ProxyManager', () => {
  describe('parseProxyString', () => {
    it('should parse HTTP proxy without auth', () => {
      const proxy = ProxyManager.parseProxyString('http://proxy.example.com:8080');
      expect(proxy).toEqual({
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
      });
    });

    it('should parse HTTP proxy with auth', () => {
      const proxy = ProxyManager.parseProxyString('http://user:pass@proxy.example.com:8080');
      expect(proxy).toEqual({
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
        username: 'user',
        password: 'pass',
      });
    });

    it('should parse HTTPS proxy', () => {
      const proxy = ProxyManager.parseProxyString('https://proxy.example.com:443');
      expect(proxy).toEqual({
        host: 'proxy.example.com',
        port: 443,
        protocol: 'https',
      });
    });

    it('should parse SOCKS5 proxy', () => {
      const proxy = ProxyManager.parseProxyString('socks5://proxy.example.com:1080');
      expect(proxy).toEqual({
        host: 'proxy.example.com',
        port: 1080,
        protocol: 'socks5',
      });
    });

    it('should use default port for HTTP', () => {
      const proxy = ProxyManager.parseProxyString('http://proxy.example.com');
      expect(proxy?.port).toBe(80);
    });

    it('should use default port for HTTPS', () => {
      const proxy = ProxyManager.parseProxyString('https://proxy.example.com');
      expect(proxy?.port).toBe(443);
    });

    it('should handle URL-encoded credentials', () => {
      const proxy = ProxyManager.parseProxyString('http://user%40email:p%40ss@proxy.example.com:8080');
      expect(proxy).toEqual({
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
        username: 'user@email',
        password: 'p@ss',
      });
    });

    it('should return null for invalid proxy string', () => {
      const proxy = ProxyManager.parseProxyString('invalid-proxy');
      expect(proxy).toBeNull();
    });
  });

  describe('ProxyManager instance', () => {
    let manager: ProxyManager;
    const testProxies: ProxyConfig[] = [
      { host: 'proxy1.example.com', port: 8080, protocol: 'http' },
      { host: 'proxy2.example.com', port: 8080, protocol: 'http' },
      { host: 'proxy3.example.com', port: 8080, protocol: 'http' },
    ];

    beforeEach(() => {
      manager = new ProxyManager(testProxies);
    });

    it('should initialize with proxies', () => {
      expect(manager.getProxyCount()).toBe(3);
      expect(manager.getHealthyProxyCount()).toBe(3);
    });

    it('should rotate proxies in round-robin fashion', () => {
      const proxy1 = manager.getNextProxy();
      const proxy2 = manager.getNextProxy();
      const proxy3 = manager.getNextProxy();
      const proxy4 = manager.getNextProxy();

      expect(proxy1).toEqual(testProxies[0]);
      expect(proxy2).toEqual(testProxies[1]);
      expect(proxy3).toEqual(testProxies[2]);
      expect(proxy4).toEqual(testProxies[0]); // Back to first
    });

    it('should track successful requests', () => {
      const proxy = manager.getNextProxy()!;
      manager.recordSuccess(proxy);

      const stats = manager.getProxyStats(proxy);
      expect(stats?.successfulRequests).toBe(1);
      expect(stats?.failedRequests).toBe(0);
      expect(stats?.isHealthy).toBe(true);
    });

    it('should track failed requests', () => {
      const proxy = manager.getNextProxy()!;
      manager.recordFailure(proxy);

      const stats = manager.getProxyStats(proxy);
      expect(stats?.failedRequests).toBe(1);
      expect(stats?.isHealthy).toBe(true); // Still healthy after 1 failure
    });

    it('should mark proxy as unhealthy after max failures', () => {
      const proxy = manager.getNextProxy()!;
      
      // Record 3 failures (max threshold)
      manager.recordFailure(proxy);
      manager.recordFailure(proxy);
      manager.recordFailure(proxy);

      const stats = manager.getProxyStats(proxy);
      expect(stats?.failedRequests).toBe(3);
      expect(stats?.isHealthy).toBe(false);
    });

    it('should skip unhealthy proxies', () => {
      const proxy1 = manager.getNextProxy()!;
      
      // Mark first proxy as unhealthy
      manager.recordFailure(proxy1);
      manager.recordFailure(proxy1);
      manager.recordFailure(proxy1);

      // Next proxy should skip the unhealthy one
      const nextProxy = manager.getNextProxy();
      expect(nextProxy).not.toEqual(proxy1);
      expect(nextProxy).toEqual(testProxies[1]); // Should be second proxy
    });

    it('should reset failure count on success', () => {
      const proxy = manager.getNextProxy()!;
      
      manager.recordFailure(proxy);
      manager.recordFailure(proxy);
      expect(manager.getProxyStats(proxy)?.failedRequests).toBe(2);

      manager.recordSuccess(proxy);
      expect(manager.getProxyStats(proxy)?.failedRequests).toBe(0);
      expect(manager.getProxyStats(proxy)?.isHealthy).toBe(true);
    });

    it('should format proxy URL correctly', () => {
      const proxy: ProxyConfig = {
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
        username: 'user',
        password: 'pass',
      };

      const url = manager.formatProxyUrl(proxy);
      expect(url).toBe('http://user:pass@proxy.example.com:8080');
    });

    it('should format proxy URL without auth', () => {
      const proxy: ProxyConfig = {
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
      };

      const url = manager.formatProxyUrl(proxy);
      expect(url).toBe('http://proxy.example.com:8080');
    });

    it('should format proxy server arg correctly', () => {
      const proxy: ProxyConfig = {
        host: 'proxy.example.com',
        port: 8080,
        protocol: 'http',
      };

      const arg = manager.formatProxyServerArg(proxy);
      expect(arg).toBe('http=proxy.example.com:8080');
    });

    it('should add proxy dynamically', () => {
      const newProxy: ProxyConfig = {
        host: 'proxy4.example.com',
        port: 8080,
        protocol: 'http',
      };

      manager.addProxy(newProxy);
      expect(manager.getProxyCount()).toBe(4);
      expect(manager.getHealthyProxyCount()).toBe(4);
    });

    it('should get all healthy proxies', () => {
      const proxy1 = testProxies[0];
      
      // Mark first proxy as unhealthy
      manager.recordFailure(proxy1);
      manager.recordFailure(proxy1);
      manager.recordFailure(proxy1);

      const healthyProxies = manager.getHealthyProxies();
      expect(healthyProxies.length).toBe(2);
      expect(healthyProxies).not.toContainEqual(proxy1);
    });

    it('should reset all statistics', () => {
      const proxy = manager.getNextProxy()!;
      manager.recordSuccess(proxy);
      manager.recordFailure(proxy);

      manager.resetStats();

      const stats = manager.getProxyStats(proxy);
      expect(stats?.totalRequests).toBe(0);
      expect(stats?.successfulRequests).toBe(0);
      expect(stats?.failedRequests).toBe(0);
      expect(stats?.isHealthy).toBe(true);
    });

    it('should manually set proxy health', () => {
      const proxy = manager.getNextProxy()!;
      
      manager.setProxyHealth(proxy, false);
      expect(manager.getProxyStats(proxy)?.isHealthy).toBe(false);

      manager.setProxyHealth(proxy, true);
      expect(manager.getProxyStats(proxy)?.isHealthy).toBe(true);
      expect(manager.getProxyStats(proxy)?.failedRequests).toBe(0);
    });
  });

  describe('fromEnvironment', () => {
    const originalEnv = process.env.PROXY_LIST;

    afterEach(() => {
      // Restore original environment
      if (originalEnv) {
        process.env.PROXY_LIST = originalEnv;
      } else {
        delete process.env.PROXY_LIST;
      }
    });

    it('should load proxies from environment variable', () => {
      process.env.PROXY_LIST = 'http://proxy1.example.com:8080,http://proxy2.example.com:8080';
      
      const manager = ProxyManager.fromEnvironment();
      expect(manager.getProxyCount()).toBe(2);
    });

    it('should handle empty environment variable', () => {
      delete process.env.PROXY_LIST;
      
      const manager = ProxyManager.fromEnvironment();
      expect(manager.getProxyCount()).toBe(0);
    });

    it('should skip invalid proxy strings', () => {
      process.env.PROXY_LIST = 'http://valid.example.com:8080,invalid-proxy,http://valid2.example.com:8080';
      
      const manager = ProxyManager.fromEnvironment();
      expect(manager.getProxyCount()).toBe(2);
    });

    it('should handle proxies with authentication', () => {
      process.env.PROXY_LIST = 'http://user:pass@proxy1.example.com:8080';
      
      const manager = ProxyManager.fromEnvironment();
      expect(manager.getProxyCount()).toBe(1);
      
      const proxy = manager.getNextProxy();
      expect(proxy?.username).toBe('user');
      expect(proxy?.password).toBe('pass');
    });
  });
});
