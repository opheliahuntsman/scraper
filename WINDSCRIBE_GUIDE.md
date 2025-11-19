# Windscribe VPN Integration Guide

This guide explains how to use Windscribe VPN with the SmartFrame scraper's proxy rotation feature.

## Overview

Windscribe offers SOCKS5 and HTTP proxy support with their VPN service, making it easy to integrate with the scraper's built-in proxy rotation.

## Prerequisites

- Active Windscribe account (Premium plan recommended for proxy access)
- Windscribe proxy credentials

## Getting Proxy Credentials

1. **Log in to Windscribe**
   - Go to https://windscribe.com/login
   - Sign in with your account

2. **Access Proxy Settings**
   - Navigate to your account settings
   - Look for the "Config Generators" or "Proxies" section
   - Find your proxy username and password (usually different from your login credentials)

3. **Generate Proxy Credentials**
   - Windscribe provides unique proxy credentials for SOCKS5 access
   - Note: Your proxy username is typically your Windscribe username
   - Your proxy password is a special password found in the proxy settings

## Windscribe Proxy Servers

Windscribe provides proxy servers in multiple locations. Common formats:

### SOCKS5 Proxies (Recommended)
```
# Format: socks5://username:password@location.windscribe.com:1080

# Examples:
socks5://youruser:yourpass@us-central.windscribe.com:1080
socks5://youruser:yourpass@uk-london.windscribe.com:1080
socks5://youruser:yourpass@ca-toronto.windscribe.com:1080
socks5://youruser:yourpass@de-frankfurt.windscribe.com:1080
socks5://youruser:yourpass@jp-tokyo.windscribe.com:1080
```

### HTTP Proxies
```
# Format: http://username:password@location.windscribe.com:80

http://youruser:yourpass@us-central.windscribe.com:80
http://youruser:yourpass@uk-london.windscribe.com:80
```

## Available Locations

Windscribe has servers in 60+ countries. Popular locations:

| Location | Server Address |
|----------|---------------|
| US Central | us-central.windscribe.com |
| US East | us-east.windscribe.com |
| US West | us-west.windscribe.com |
| UK London | uk-london.windscribe.com |
| Canada | ca-toronto.windscribe.com |
| Germany | de-frankfurt.windscribe.com |
| France | fr-paris.windscribe.com |
| Netherlands | nl-amsterdam.windscribe.com |
| Japan | jp-tokyo.windscribe.com |
| Australia | au-sydney.windscribe.com |
| Singapore | sg-singapore.windscribe.com |

For a complete list, visit: https://windscribe.com/status

## Configuration

### Single Proxy Setup

```bash
# Set environment variable
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080"
```

### Multiple Proxy Rotation (Recommended)

Rotate between different geographic locations for better distribution:

```bash
# Multiple locations for maximum reliability
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080,socks5://youruser:yourpass@de-frankfurt.windscribe.com:1080,socks5://youruser:yourpass@ca-toronto.windscribe.com:1080"
```

### Replit Configuration

1. Click the **Lock icon** 🔒 (Secrets) in Replit
2. Add new secret:
   - **Key**: `PROXY_LIST`
   - **Value**: Your Windscribe proxy string (see examples above)
3. Restart your application

### Docker Configuration

```bash
docker run -e PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080" your-image
```

### Local Development (.env file)

Create or edit `.env` file in project root:

```bash
# Windscribe SOCKS5 Proxies
PROXY_LIST=socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080,socks5://youruser:yourpass@de-frankfurt.windscribe.com:1080
```

## Testing Your Configuration

### 1. Test Proxy Connectivity

```bash
# Test SOCKS5 proxy with curl
curl --socks5 youruser:yourpass@us-central.windscribe.com:1080 https://api.ipify.org?format=json

# Expected output: Shows Windscribe proxy IP address
```

### 2. Verify in Scraper

Run a small test scrape (5-10 images) and check logs:

```
[Scraper] Using proxy: socks5=us-central.windscribe.com:1080
[ProxyManager] Loaded 4 proxies from environment
```

## Recommended Configuration

### For Small Jobs (<50 images)
```bash
# Single location is sufficient
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080"
```

### For Medium Jobs (50-500 images)
```bash
# 2-3 locations for better distribution
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080"
```

### For Large Jobs (>500 images)
```bash
# 4-6 locations across different continents
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080,socks5://youruser:yourpass@de-frankfurt.windscribe.com:1080,socks5://youruser:yourpass@jp-tokyo.windscribe.com:1080,socks5://youruser:yourpass@au-sydney.windscribe.com:1080"
```

## Troubleshooting

### Authentication Failed
- **Problem**: `407 Proxy Authentication Required`
- **Solution**: 
  - Verify credentials in Windscribe account settings
  - Ensure you're using proxy password (not account password)
  - Check if credentials need URL encoding (use `%40` for `@`, etc.)

### Connection Timeout
- **Problem**: Proxy connection times out
- **Solution**:
  - Check Windscribe server status: https://windscribe.com/status
  - Try a different location
  - Verify your Windscribe account is active

### Still Getting Rate Limited
- **Problem**: Rate limiting despite using proxies
- **Solution**:
  - Add more proxy locations to rotation
  - Increase delays between requests in scraper config
  - Use locations in different geographic regions

### Proxy Marked as Unhealthy
- **Problem**: Logs show "Proxy marked as unhealthy"
- **Solution**:
  - Check Windscribe server status
  - Verify credentials are correct
  - Try different server location
  - Ensure your Windscribe plan includes proxy access

## Performance Tips

1. **Choose Nearby Locations**: Use servers geographically close to your actual location for lower latency
2. **Mix Regions**: Distribute across US, EU, and Asia for better coverage
3. **Monitor Health**: Check logs for proxy health status
4. **Avoid Free Plan**: Free plan has limited proxy access - Premium recommended

## Security Notes

- ✅ SOCKS5 provides encryption between you and Windscribe
- ✅ Credentials stored in environment variables (not in code)
- ✅ Never commit proxy credentials to version control
- ✅ Use Replit Secrets or similar for credential management

## Windscribe Plans

| Plan | Proxy Access | Recommended For |
|------|-------------|-----------------|
| Free | Limited | Testing only |
| Pro | Full access | Production use |
| Static IP | Dedicated IP | Advanced use cases |

**Note**: Premium/Pro plan is recommended for reliable proxy access.

## Support

- **Windscribe Help**: https://windscribe.com/support
- **Proxy Setup Guide**: https://windscribe.com/support/article/21/using-windscribe-with-torrent-clients
- **Server Status**: https://windscribe.com/status

## Summary

Windscribe integration is simple:
1. Get your proxy credentials from Windscribe settings
2. Set `PROXY_LIST` with SOCKS5 format
3. Use multiple locations for rotation
4. Monitor logs for health status

Example final configuration:
```bash
PROXY_LIST="socks5://youruser:yourpass@us-central.windscribe.com:1080,socks5://youruser:yourpass@uk-london.windscribe.com:1080,socks5://youruser:yourpass@de-frankfurt.windscribe.com:1080"
```

That's it! The scraper will automatically rotate through your Windscribe proxies with health monitoring.
