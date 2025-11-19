# VPN Auto-Change Feature Guide

This guide explains how to configure the scraper to automatically change VPN locations during scraping, with connection verification before continuing.

## Overview

The VPN auto-change feature allows you to:
- Execute custom VPN commands during scraping
- Automatically change VPN locations when needed
- Verify connection is live before continuing
- Support any VPN provider (Windscribe, NordVPN, ExpressVPN, etc.)

## How It Works

1. **VPN Change**: Executes your custom command to change VPN
2. **Wait**: Waits for VPN to stabilize (configurable delay)
3. **Verify**: Checks connection is active (IP check or custom command)
4. **Continue**: Only proceeds with scraping after verification passes

## Quick Start

### Environment Variables

```bash
# Enable VPN management
VPN_ENABLED=true

# Command to change VPN (use {location} as placeholder)
VPN_CHANGE_COMMAND="windscribe connect {location}"

# Optional: Custom verify command
VPN_VERIFY_COMMAND="windscribe status"

# Optional: Wait time after change (ms, default: 5000)
VPN_WAIT_AFTER_CHANGE=5000

# Optional: Max verify attempts (default: 10)
VPN_MAX_VERIFY_ATTEMPTS=10

# Optional: Delay between verify attempts (ms, default: 2000)
VPN_VERIFY_DELAY=2000
```

## VPN Provider Examples

### Windscribe

#### Windows
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="windscribe connect {location}"
VPN_VERIFY_COMMAND="windscribe status"
```

Locations: `US-Central`, `UK-London`, `CA-Toronto`, `DE-Frankfurt`, etc.

#### Linux/Mac
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="windscribe connect {location}"
VPN_VERIFY_COMMAND="windscribe status"
```

### NordVPN

#### Windows
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="nordvpn -c -n {location}"
VPN_VERIFY_COMMAND="nordvpn -status"
```

Locations: `United_States`, `United_Kingdom`, `Canada`, `Germany`, etc.

#### Linux
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="nordvpn connect {location}"
VPN_VERIFY_COMMAND="nordvpn status"
```

#### Mac
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="nordvpn connect {location}"
VPN_VERIFY_COMMAND="nordvpn status"
```

### ExpressVPN

#### Windows
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="expressvpn connect {location}"
VPN_VERIFY_COMMAND="expressvpn status"
```

#### Linux/Mac
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="expressvpn connect {location}"
VPN_VERIFY_COMMAND="expressvpn status"
```

### ProtonVPN

#### Windows
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="protonvpn-cli c {location}"
VPN_VERIFY_COMMAND="protonvpn-cli status"
```

#### Linux
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="protonvpn-cli c --cc {location}"
VPN_VERIFY_COMMAND="protonvpn-cli s"
```

### Custom VPN (Generic)

```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="/path/to/your/vpn-script.sh {location}"
VPN_VERIFY_COMMAND="/path/to/your/vpn-verify.sh"
```

## Configuration Options

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `VPN_ENABLED` | Enable/disable VPN management | `false` | Yes |
| `VPN_CHANGE_COMMAND` | Command to change VPN | - | Yes if enabled |
| `VPN_VERIFY_COMMAND` | Command to verify connection | Uses IP check | No |
| `VPN_WAIT_AFTER_CHANGE` | Wait time after change (ms) | `5000` | No |
| `VPN_MAX_VERIFY_ATTEMPTS` | Max connection verification attempts | `10` | No |
| `VPN_VERIFY_DELAY` | Delay between verify attempts (ms) | `2000` | No |

## Using {location} Placeholder

The `{location}` placeholder in your command will be replaced with the actual location when changing VPN:

```bash
# Command template
VPN_CHANGE_COMMAND="windscribe connect {location}"

# Becomes
windscribe connect US-Central
```

## Verification Methods

### Method 1: IP Check (Default)

If no `VPN_VERIFY_COMMAND` is provided, the system checks your public IP via `api.ipify.org`:

```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="windscribe connect {location}"
# No VPN_VERIFY_COMMAND - uses IP check
```

**Pros:**
- Works with any VPN provider
- No provider-specific commands needed
- Reliable connection check

**Cons:**
- Requires internet access to ipify.org
- Slight delay for HTTP request

### Method 2: Custom Verify Command

Provide a command that outputs something when VPN is connected:

```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="windscribe connect {location}"
VPN_VERIFY_COMMAND="windscribe status"
```

**Pros:**
- Faster than IP check
- Provider-specific status
- Can check specific VPN features

**Cons:**
- Requires provider CLI support
- Must return output when connected

## Example Workflow

When VPN auto-change is enabled, the scraper:

1. **Before Rate Limit**: Detects potential rate limiting
2. **Change VPN**: Executes `VPN_CHANGE_COMMAND`
3. **Wait**: Sleeps for `VPN_WAIT_AFTER_CHANGE` milliseconds
4. **Verify Loop**:
   - Attempts to verify connection
   - Retries up to `VPN_MAX_VERIFY_ATTEMPTS` times
   - Waits `VPN_VERIFY_DELAY` between attempts
5. **Continue**: Only proceeds if verification succeeds
6. **Resume Scraping**: Continues with new IP address

## Advanced Usage

### Multiple Location Rotation

Create a custom script that rotates through locations:

**vpn-rotate.sh:**
```bash
#!/bin/bash
locations=("US-Central" "UK-London" "DE-Frankfurt" "CA-Toronto")
location=${locations[$RANDOM % ${#locations[@]}]}
windscribe connect "$location"
echo "Connected to: $location"
```

**Configuration:**
```bash
VPN_ENABLED=true
VPN_CHANGE_COMMAND="./vpn-rotate.sh"
VPN_VERIFY_COMMAND="windscribe status"
```

### Conditional VPN Changes

You can implement logic in your script to change VPN only under certain conditions:

```bash
#!/bin/bash
# Only change if current IP is blocked
current_ip=$(curl -s https://api.ipify.org)
if is_ip_blocked "$current_ip"; then
    windscribe connect "$1"
fi
```

### Logging

Add logging to your VPN commands:

```bash
VPN_CHANGE_COMMAND="windscribe connect {location} 2>&1 | tee -a vpn-changes.log"
```

## Replit Configuration

In Replit, add environment variables via Secrets:

1. Click **Lock icon** 🔒 (Secrets)
2. Add secrets:
   - **Key**: `VPN_ENABLED`, **Value**: `true`
   - **Key**: `VPN_CHANGE_COMMAND`, **Value**: `windscribe connect {location}`
   - **Key**: `VPN_VERIFY_COMMAND`, **Value**: `windscribe status`
3. Restart application

**Note**: Replit environment may have limitations running VPN clients. Test thoroughly.

## Docker Configuration

Add environment variables to your Docker command:

```bash
docker run \
  -e VPN_ENABLED=true \
  -e VPN_CHANGE_COMMAND="windscribe connect {location}" \
  -e VPN_VERIFY_COMMAND="windscribe status" \
  your-image
```

Or in `docker-compose.yml`:

```yaml
services:
  scraper:
    environment:
      - VPN_ENABLED=true
      - VPN_CHANGE_COMMAND=windscribe connect {location}
      - VPN_VERIFY_COMMAND=windscribe status
```

## Troubleshooting

### VPN Command Not Found

**Problem**: `command not found: windscribe`

**Solutions**:
1. Install VPN CLI client
2. Add VPN binary to PATH
3. Use full path: `/usr/local/bin/windscribe connect {location}`

### VPN Change Fails

**Problem**: `VPN change failed`

**Solutions**:
1. Check command syntax is correct
2. Verify VPN client is installed
3. Test command manually in terminal
4. Check VPN client logs
5. Ensure proper permissions

### Connection Verification Fails

**Problem**: `VPN connection could not be verified`

**Solutions**:
1. Increase `VPN_WAIT_AFTER_CHANGE` (try 10000ms)
2. Increase `VPN_MAX_VERIFY_ATTEMPTS` (try 20)
3. Increase `VPN_VERIFY_DELAY` (try 3000ms)
4. Check VPN actually connects manually
5. Try different verification method

### Slow Connection Checks

**Problem**: Verification takes too long

**Solutions**:
1. Reduce `VPN_MAX_VERIFY_ATTEMPTS`
2. Reduce `VPN_VERIFY_DELAY`
3. Use custom verify command instead of IP check
4. Optimize your verify command

## Best Practices

1. **Test Commands First**: Test your VPN commands manually before configuring
2. **Start Conservative**: Use higher wait times initially, reduce later
3. **Monitor Logs**: Watch scraper logs to see VPN changes in action
4. **Backup Connection**: Have fallback internet connection available
5. **Rate Limit Awareness**: Combine with retry logic for best results
6. **Location Strategy**: Rotate between geographically diverse locations

## Security Notes

- ✅ Commands are executed in isolated environment
- ✅ No credentials stored in scraper code
- ✅ VPN credentials managed by VPN client
- ⚠️ Ensure VPN command doesn't expose credentials in logs
- ⚠️ Use environment variables, never hardcode commands

## Performance Impact

| Aspect | Impact | Mitigation |
|--------|--------|------------|
| VPN Change Time | 5-15 seconds | Optimize `VPN_WAIT_AFTER_CHANGE` |
| Verification Time | 2-20 seconds | Use fast verify command |
| Total Overhead | 7-35 seconds per change | Change only when needed |

## Example: Complete Windscribe Setup

### Step 1: Install Windscribe CLI

**Windows**: Download from https://windscribe.com/download
**Linux**: `sudo apt-get install windscribe-cli`
**Mac**: `brew install windscribe`

### Step 2: Login to Windscribe

```bash
windscribe login
# Enter your credentials
```

### Step 3: Test Commands

```bash
# Test change
windscribe connect US-Central

# Test verify
windscribe status

# Should show "Connected" status
```

### Step 4: Configure Environment

```bash
export VPN_ENABLED=true
export VPN_CHANGE_COMMAND="windscribe connect {location}"
export VPN_VERIFY_COMMAND="windscribe status"
```

### Step 5: Run Scraper

```bash
npm run dev
```

### Step 6: Monitor

Watch logs for VPN change messages:
```
🔄 Changing VPN location...
[VPNManager] Executing: windscribe connect US-Central
✅ VPN change command executed successfully
🔍 Verifying VPN connection...
✅ VPN connection verified
```

## Summary

The VPN auto-change feature provides:
- ✅ Automatic VPN location changes
- ✅ Connection verification before continuing
- ✅ Support for any VPN provider
- ✅ Flexible configuration via environment variables
- ✅ Robust retry and verification logic

Configure your VPN provider's CLI commands and the scraper handles the rest!
