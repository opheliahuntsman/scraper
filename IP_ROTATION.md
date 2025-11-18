# IP Rotation Guide

## Overview

The SmartFrame scraper currently does **not** include built-in IP rotation functionality. However, if you're experiencing rate limiting issues, you can configure external proxy rotation.

## Why IP Rotation?

IP rotation can help with:
- **Rate Limiting**: Distribute requests across multiple IP addresses to avoid hitting rate limits
- **Geographic Restrictions**: Access content from different geographic locations
- **Reliability**: Fallback to alternative IPs if one is blocked

## Current Retry Mechanism

The scraper includes a robust retry mechanism without IP rotation:

1. **Multiple Retry Rounds**: Failed images are retried up to 2 times with increasing delays
2. **Exponential Backoff**: Delays increase exponentially (2s → 4s → 8s for server errors, 5s → 10s → 20s for rate limits)
3. **Smart Error Filtering**: Non-retryable errors (404, 403, 401) are automatically skipped
4. **Low Concurrency**: Retries use concurrency of 1 to minimize rate limiting risk
5. **Batch Delays**: Longer delays between batches (3s, 6s based on retry round)

## Implementing IP Rotation (External Proxy)

If you need IP rotation, you can use external proxy services. Here are the recommended approaches:

### Option 1: Using Proxy Services (Recommended)

Popular proxy services:
- **Bright Data** (formerly Luminati)
- **Smartproxy**
- **Oxylabs**
- **ScraperAPI**

### Option 2: Manual Proxy Configuration

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

## Environment Variables

Add these to your `.env` file:

```bash
# Proxy Configuration (Optional)
PROXY_HOST=your-proxy-host
PROXY_PORT=8080
PROXY_USERNAME=username
PROXY_PASSWORD=password
```

## Best Practices

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
   - Check proxy credentials
   - Verify proxy is active and accessible
   - Increase timeout in Puppeteer config

2. **Authentication Failed**
   - Double-check username/password
   - Some proxies require URL encoding of credentials

3. **Still Getting Rate Limited**
   - Increase delays between requests
   - Use more proxies in rotation
   - Consider residential proxies instead of datacenter proxies

## Notes

- The current retry mechanism with exponential backoff is often sufficient
- IP rotation adds complexity and cost
- Many rate limiting issues can be solved with proper delays and retry logic
- Always comply with the target website's Terms of Service and robots.txt
