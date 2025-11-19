# IP Rotation Guide

## Overview

The SmartFrame scraper now includes **built-in proxy rotation** functionality for IP rotation. This feature helps distribute requests across multiple IP addresses to avoid rate limiting and improve scraping reliability.

## Features

✅ **Proxy Pool Management** - Supports multiple proxies with automatic rotation  
✅ **Health Monitoring** - Tracks proxy performance and automatically disables unhealthy proxies  
✅ **Authentication Support** - Handles username/password authentication  
✅ **Multiple Protocols** - Supports HTTP, HTTPS, and SOCKS5 proxies  
✅ **Automatic Failover** - Switches to healthy proxies when failures occur  
✅ **Statistics Tracking** - Monitors success/failure rates for each proxy

## Why IP Rotation?

IP rotation can help with:
- **Rate Limiting**: Distribute requests across multiple IP addresses to avoid hitting rate limits
- **Geographic Restrictions**: Access content from different geographic locations
- **Reliability**: Fallback to alternative IPs if one is blocked

## VPN Service Guides

Looking to use a popular VPN service? We have detailed setup guides:

- **[VPN Auto-Change Guide](VPN_AUTOCHANGE_GUIDE.md)** - **NEW!** Automatic VPN location changes with connection verification
- **[Windscribe Guide](WINDSCRIBE_GUIDE.md)** - Step-by-step setup for Windscribe VPN  
- **[NordVPN Guide](NORDVPN_GUIDE.md)** - Complete configuration for NordVPN

The **VPN Auto-Change** feature allows the scraper to automatically execute VPN commands and verify connections before continuing - perfect for avoiding rate limits without manual intervention!

## Quick Start

### Environment Variable Configuration

The easiest way to configure proxies is through environment variables:

```bash
# Single proxy
PROXY_LIST="http://proxy.example.com:8080"

# Multiple proxies (comma-separated)
PROXY_LIST="http://proxy1.example.com:8080,http://proxy2.example.com:8080,http://proxy3.example.com:8080"

# With authentication
PROXY_LIST="http://user:pass@proxy1.example.com:8080,http://user:pass@proxy2.example.com:8080"

# Mixed protocols
PROXY_LIST="http://proxy1.example.com:8080,https://proxy2.example.com:443,socks5://proxy3.example.com:1080"
```

### Supported Proxy Formats

```bash
# HTTP proxy
http://host:port

# HTTP proxy with authentication
http://username:password@host:port

# HTTPS proxy
https://host:port

# SOCKS5 proxy
socks5://host:port
```

### How It Works

1. **Automatic Loading**: Proxies are automatically loaded from `PROXY_LIST` environment variable on startup
2. **Round-Robin Rotation**: Each request uses the next proxy in the pool
3. **Health Monitoring**: Failed proxies are automatically marked as unhealthy
4. **Automatic Failover**: System skips unhealthy proxies and uses only healthy ones
5. **Statistics Tracking**: Success/failure rates are tracked for monitoring

## Current Retry Mechanism

The scraper includes a robust retry mechanism without IP rotation:

1. **Multiple Retry Rounds**: Failed images are retried up to 2 times with increasing delays
2. **Exponential Backoff**: Delays increase exponentially (2s → 4s → 8s for server errors, 5s → 10s → 20s for rate limits)
3. **Smart Error Filtering**: Non-retryable errors (404, 403, 401) are automatically skipped
4. **Low Concurrency**: Retries use concurrency of 1 to minimize rate limiting risk
5. **Batch Delays**: Longer delays between batches (3s, 6s based on retry round)

The scraper includes a robust retry mechanism that works **in combination** with proxy rotation:

1. **Multiple Retry Rounds**: Failed images are retried up to 2 times with increasing delays
2. **Exponential Backoff**: Delays increase exponentially (2s → 4s → 8s for server errors, 5s → 10s → 20s for rate limits)
3. **Smart Error Filtering**: Non-retryable errors (404, 403, 401) are automatically skipped
4. **Low Concurrency**: Retries use concurrency of 1 to minimize rate limiting risk
5. **Batch Delays**: Longer delays between batches (3s, 6s based on retry round)
6. **Proxy Rotation**: Each retry attempt can use a different proxy from the pool

## Proxy Configuration Examples

### Using Replit Secrets (Recommended for Replit)

1. Go to the Secrets tab (lock icon 🔒) in your Repl
2. Add a new secret:
   - **Key**: `PROXY_LIST`
   - **Value**: Your comma-separated proxy list
3. Restart your application

### Using .env File (Local Development)

Create a `.env` file in the project root:

```bash
# Proxy Configuration
PROXY_LIST=http://proxy1.example.com:8080,http://proxy2.example.com:8080

# Or with authentication
PROXY_LIST=http://user:pass@proxy1.example.com:8080,http://user:pass@proxy2.example.com:8080
```

### Using Docker Environment Variables

```bash
docker run -e PROXY_LIST="http://proxy1:8080,http://proxy2:8080" your-image
```

## Proxy Services (Recommended)

Popular proxy services that work well with this implementation:

- **Bright Data** (formerly Luminati) - Enterprise-grade residential proxies
- **Smartproxy** - Residential and datacenter proxies
- **Oxylabs** - Large proxy pool with good reliability  
- **IPRoyal** - Affordable residential proxies
- **Proxy-Seller** - Budget-friendly datacenter proxies

## Advanced Configuration

### Proxy Health Monitoring

The system automatically monitors proxy health:

```typescript
// Proxies are marked unhealthy after 3 consecutive failures
// Unhealthy proxies are automatically skipped
// Health checks can be manually triggered or scheduled
```

### Manual Proxy Management (Advanced)

For advanced use cases, you can programmatically manage proxies:

```typescript
import { getProxyManager } from './server/proxy-manager';

const proxyManager = getProxyManager();

// Add a proxy manually
proxyManager.addProxy({
  host: 'proxy.example.com',
  port: 8080,
  username: 'user',
  password: 'pass',
  protocol: 'http'
});

// Get statistics
const stats = proxyManager.getAllStats();
console.log(stats);

// Get healthy proxy count
const healthyCount = proxyManager.getHealthyProxyCount();
```

## Implementing IP Rotation (Legacy Options)

### Option 1: Using Proxy Services (Recommended)

**Note**: With the new built-in proxy rotation, you no longer need to modify code. Just set the `PROXY_LIST` environment variable with proxies from these services.

Popular proxy services:
- **Bright Data** (formerly Luminati)
- **Smartproxy**
- **Oxylabs**
- **ScraperAPI**

### Option 2: Manual Code Configuration (Not Recommended)

**Note**: This is no longer necessary. Use the `PROXY_LIST` environment variable instead.

<details>
<summary>Legacy manual configuration (click to expand)</summary>

To add proxy support to Puppeteer, modify `server/scraper.ts`:

```typescript
// In the initialize() method, add proxy args:
this.browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    // Add proxy configuration
    '--proxy-server=http://your-proxy-host:port'
  ],
});
```

### Option 3: Rotating Proxy Pool

For advanced users, implement a proxy pool:

```typescript
class ProxyPool {
  private proxies: string[] = [];
  private currentIndex = 0;

  constructor(proxies: string[]) {
    this.proxies = proxies;
  }

  getNext(): string {
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }
}

// Usage:
const proxyPool = new ProxyPool([
  'http://proxy1:port',
  'http://proxy2:port',
  'http://proxy3:port',
]);

// In browser launch:
args: [`--proxy-server=${proxyPool.getNext()}`]
```

</details>

## Environment Variables (Legacy)

**Note**: With the new implementation, you only need `PROXY_LIST`. Other variables are no longer used.

<details>
<summary>Legacy environment variables (click to expand)</summary>

Add these to your `.env` file:

```bash
# Proxy Configuration (Optional)
PROXY_HOST=your-proxy-host
PROXY_PORT=8080
PROXY_USERNAME=username
PROXY_PASSWORD=password
```

</details>

## Monitoring and Debugging

### Checking Proxy Status

The scraper logs proxy usage and health status:

```
[Scraper] Using proxy: http://proxy1.example.com:8080
[ProxyManager] Loaded 3 proxies from environment
[ProxyManager] Health check complete: 2/3 proxies healthy
```

### Common Log Messages

- `Using proxy: ...` - Indicates which proxy is being used
- `No proxy configured` - No proxies in environment, using direct connection
- `Proxy marked as unhealthy` - Proxy failed too many times
- `No healthy proxies available` - All proxies are unhealthy, using degraded mode

### Troubleshooting

1. **Start Without Proxies**: Try the improved retry mechanism first
2. **Monitor Rate Limits**: Only add proxies if you consistently hit rate limits
3. **Residential Proxies**: Use residential proxies for better success rates
4. **Rotate User Agents**: Combine with user agent rotation for best results
5. **Respect Rate Limits**: Even with proxies, add appropriate delays

## Testing Proxy Configuration

Test your proxy setup:

```bash
curl -x http://your-proxy:port https://api.ipify.org?format=json
```

Expected output should show the proxy's IP address.

## Troubleshooting

**Common Issues:**

1. **Proxy Connection Timeout**
   - **Solution**: Check proxy credentials and ensure proxy is active
   - **Check**: Verify `PROXY_LIST` format is correct
   - **Test**: Use curl to test proxy connectivity
   - **Note**: System will automatically mark unhealthy proxies and skip them

2. **Authentication Failed**
   - **Solution**: Double-check username/password in `PROXY_LIST`
   - **Tip**: Ensure special characters in passwords are properly URL-encoded
   - **Example**: Use `%40` for `@`, `%3A` for `:`, etc.

3. **Still Getting Rate Limited**
   - **Solution**: Add more proxies to the rotation pool
   - **Increase delays**: Consider longer delays between batches
   - **Check proxy type**: Residential proxies work better than datacenter
   - **Monitor stats**: Check which proxies are failing

4. **All Proxies Marked Unhealthy**
   - **Check**: Verify proxies are actually working (test with curl)
   - **Firewall**: Ensure your server can reach proxy hosts
   - **Credentials**: Verify authentication details are correct
   - **Provider**: Contact your proxy provider for status

5. **No Proxy Configured Message**
   - **Solution**: Ensure `PROXY_LIST` environment variable is set
   - **Replit**: Add it to Secrets (lock icon 🔒)
   - **Local**: Add to `.env` file in project root
   - **Docker**: Pass as `-e PROXY_LIST=...`

## Performance Considerations

### Impact on Speed

- **Without proxies**: Direct connection, fastest
- **With proxies**: Slight overhead (typically 100-500ms per request)
- **Multiple proxies**: Same overhead, but better reliability

### Recommended Configuration

- **Small jobs (<50 images)**: No proxy needed
- **Medium jobs (50-500 images)**: 2-3 proxies recommended  
- **Large jobs (>500 images)**: 5+ proxies recommended
- **Very large jobs (>1000 images)**: 10+ proxies with residential IPs

## Security Notes

- **Credential Protection**: Never commit proxy credentials to version control
- **Use Secrets**: Store `PROXY_LIST` in environment variables or secrets management
- **Encryption**: Use HTTPS/SOCKS5 proxies for encrypted connections when possible
- **Validate Proxies**: Only use proxies from trusted providers
- **Monitor Usage**: Regularly check proxy usage to detect unauthorized access
- **Compliance**: Always comply with the target website's Terms of Service and robots.txt
- **Logging**: Proxy credentials are never logged by the system

## Summary

The built-in proxy rotation feature provides:
- ✅ Easy configuration via environment variables
- ✅ Automatic health monitoring and failover
- ✅ Support for authentication and multiple protocols
- ✅ Statistics tracking for monitoring
- ✅ Seamless integration with existing retry mechanisms

For most use cases, simply set the `PROXY_LIST` environment variable and the system handles the rest!
