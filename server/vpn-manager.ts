/**
 * VPN Manager for changing VPN locations during scraping
 * 
 * Supports executing user-defined VPN commands (Windscribe, NordVPN, etc.)
 * and verifying connection before continuing scraping.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';

const execAsync = promisify(exec);

export interface VPNConfig {
  enabled: boolean;
  changeCommand?: string; // Command to change VPN location
  verifyCommand?: string; // Command to verify VPN is connected
  waitAfterChange?: number; // Milliseconds to wait after changing VPN
  maxVerifyAttempts?: number; // Max attempts to verify connection
  verifyDelay?: number; // Delay between verify attempts in ms
}

export interface VPNStatus {
  isConnected: boolean;
  currentIP?: string;
  location?: string;
  timestamp: Date;
}

export class VPNManager {
  private config: VPNConfig;
  private lastChange: Date | null = null;
  private currentStatus: VPNStatus | null = null;

  constructor(config: VPNConfig = { enabled: false }) {
    this.config = {
      waitAfterChange: 5000,
      maxVerifyAttempts: 10,
      verifyDelay: 2000,
      ...config,
    };
  }

  /**
   * Execute VPN change command
   * @param location Optional location parameter for command
   */
  async changeVPN(location?: string): Promise<boolean> {
    if (!this.config.enabled || !this.config.changeCommand) {
      console.log('[VPNManager] VPN change not configured, skipping');
      return true;
    }

    try {
      console.log('\n🔄 Changing VPN location...');
      
      // Replace {location} placeholder in command if provided
      let command = this.config.changeCommand;
      if (location) {
        command = command.replace('{location}', location);
      }

      console.log(`[VPNManager] Executing: ${command}`);
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stdout) console.log(`[VPNManager] Output: ${stdout.trim()}`);
      if (stderr) console.warn(`[VPNManager] Warning: ${stderr.trim()}`);

      // Wait for VPN to stabilize
      console.log(`[VPNManager] Waiting ${this.config.waitAfterChange}ms for VPN to stabilize...`);
      await new Promise(resolve => setTimeout(resolve, this.config.waitAfterChange));

      this.lastChange = new Date();
      console.log('✅ VPN change command executed successfully\n');
      
      return true;
    } catch (error) {
      console.error('❌ VPN change failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Verify VPN connection is active
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.config.enabled) {
      return true; // If VPN not enabled, consider it "verified"
    }

    console.log('🔍 Verifying VPN connection...');

    // If custom verify command is provided, use it
    if (this.config.verifyCommand) {
      return await this.verifyWithCommand();
    }

    // Otherwise, use IP check
    return await this.verifyWithIPCheck();
  }

  /**
   * Verify using custom command
   */
  private async verifyWithCommand(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(this.config.verifyCommand!);
      console.log(`[VPNManager] Verify output: ${stdout.trim()}`);
      
      // Consider non-empty output as success
      const isConnected = stdout.trim().length > 0;
      
      if (isConnected) {
        console.log('✅ VPN connection verified');
      } else {
        console.warn('⚠️  VPN connection check returned empty result');
      }
      
      return isConnected;
    } catch (error) {
      console.error('❌ VPN verify command failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Verify by checking current IP address
   */
  private async verifyWithIPCheck(): Promise<boolean> {
    try {
      const ip = await this.getCurrentIP();
      
      if (ip) {
        this.currentStatus = {
          isConnected: true,
          currentIP: ip,
          timestamp: new Date(),
        };
        
        console.log(`✅ VPN connection verified - IP: ${ip}`);
        return true;
      }
      
      console.warn('⚠️  Could not retrieve current IP');
      return false;
    } catch (error) {
      console.error('❌ IP check failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Get current public IP address
   */
  async getCurrentIP(): Promise<string | null> {
    return new Promise((resolve) => {
      const request = https.get('https://api.ipify.org?format=json', (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip || null);
          } catch (error) {
            resolve(null);
          }
        });
      });

      request.on('error', () => {
        resolve(null);
      });

      request.setTimeout(10000, () => {
        request.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Wait for VPN connection to be established
   * Retries verification multiple times
   */
  async waitForConnection(): Promise<boolean> {
    console.log('⏳ Waiting for VPN connection...');
    
    const maxAttempts = this.config.maxVerifyAttempts || 10;
    const delay = this.config.verifyDelay || 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[VPNManager] Connection check attempt ${attempt}/${maxAttempts}...`);
      
      const isConnected = await this.verifyConnection();
      
      if (isConnected) {
        console.log(`✅ VPN connection established after ${attempt} attempt(s)\n`);
        return true;
      }

      if (attempt < maxAttempts) {
        console.log(`[VPNManager] Not connected yet, waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.error(`❌ VPN connection could not be verified after ${maxAttempts} attempts\n`);
    return false;
  }

  /**
   * Change VPN and wait for connection to be established
   * @param location Optional location to connect to
   */
  async changeAndVerify(location?: string): Promise<boolean> {
    // Execute change command
    const changeSuccess = await this.changeVPN(location);
    
    if (!changeSuccess) {
      console.error('❌ VPN change failed, cannot proceed');
      return false;
    }

    // Wait for connection to be established
    const connectionSuccess = await this.waitForConnection();
    
    if (!connectionSuccess) {
      console.error('❌ VPN connection could not be verified, cannot proceed');
      return false;
    }

    return true;
  }

  /**
   * Get current VPN status
   */
  getStatus(): VPNStatus | null {
    return this.currentStatus;
  }

  /**
   * Check if VPN was recently changed
   */
  getLastChange(): Date | null {
    return this.lastChange;
  }

  /**
   * Load VPN configuration from environment variables
   */
  static fromEnvironment(): VPNManager {
    const config: VPNConfig = {
      enabled: process.env.VPN_ENABLED === 'true',
      changeCommand: process.env.VPN_CHANGE_COMMAND,
      verifyCommand: process.env.VPN_VERIFY_COMMAND,
      waitAfterChange: process.env.VPN_WAIT_AFTER_CHANGE ? parseInt(process.env.VPN_WAIT_AFTER_CHANGE) : 5000,
      maxVerifyAttempts: process.env.VPN_MAX_VERIFY_ATTEMPTS ? parseInt(process.env.VPN_MAX_VERIFY_ATTEMPTS) : 10,
      verifyDelay: process.env.VPN_VERIFY_DELAY ? parseInt(process.env.VPN_VERIFY_DELAY) : 2000,
    };

    if (config.enabled) {
      console.log('[VPNManager] VPN management enabled');
      if (config.changeCommand) {
        console.log(`[VPNManager] Change command: ${config.changeCommand}`);
      }
      if (config.verifyCommand) {
        console.log(`[VPNManager] Verify command: ${config.verifyCommand}`);
      }
    } else {
      console.log('[VPNManager] VPN management disabled');
    }

    return new VPNManager(config);
  }
}

// Singleton instance
let vpnManagerInstance: VPNManager | null = null;

/**
 * Get or create the global VPN manager instance
 */
export function getVPNManager(): VPNManager {
  if (!vpnManagerInstance) {
    vpnManagerInstance = VPNManager.fromEnvironment();
  }
  return vpnManagerInstance;
}

/**
 * Reset the global VPN manager instance
 */
export function resetVPNManager(): void {
  vpnManagerInstance = null;
}
