// main.js - Main Electron process with server-based validation
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');

class ProtectionLayer {
  constructor() {
    this.mainWindow = null;
    // Look for the embedded executable in the resources folder
    this.embeddedExePath = this.findEmbeddedExecutable();
    this.tempExePath = null;
    this.isValidated = false;
    
    // Server configuration
    this.serverConfig = {
      host: process.env.LICENSE_SERVER_HOST || 'localhost',
      port: process.env.LICENSE_SERVER_PORT || 3000,
      useHttps: process.env.USE_HTTPS === 'true' || false,
      timeout: 10000 // 10 seconds
    };
    
    this.serverUrl = `${this.serverConfig.useHttps ? 'https' : 'http'}://${this.serverConfig.host}:${this.serverConfig.port}/api`;
  }

  // Find the embedded executable
  findEmbeddedExecutable() {
    // Different paths for development vs production
    const isDev = !app.isPackaged;
    
    let possiblePaths = [];
    
    if (isDev) {
      // Development mode paths
      possiblePaths = [
        path.join(__dirname, 'embedded', 'app.exe'),
        path.join(__dirname, 'resources', 'app.exe')
      ];
    } else {
      // Production mode paths - hide the original exe better
      possiblePaths = [
        path.join(process.resourcesPath, 'app.exe'),
        path.join(process.resourcesPath, 'embedded', 'app.exe'),
        path.join(process.resourcesPath, '.hidden', 'app.exe'),
        path.join(process.resourcesPath, 'bin', 'protected.exe'),
        path.join(__dirname, '..', 'app.exe'),
        path.join(__dirname, '..', '..', 'resources', 'app.exe')
      ];
    }

    console.log('🔍 Searching for embedded executable...');
    console.log('isDev:', isDev);
    console.log('__dirname:', __dirname);
    console.log('process.resourcesPath:', process.resourcesPath);
    
    for (const exePath of possiblePaths) {
      console.log(`Checking: ${exePath}`);
      if (fs.existsSync(exePath)) {
        console.log(`✓ Found embedded executable at: ${exePath}`);
        return exePath;
      }
    }

    console.error('❌ Embedded executable not found in any expected location');
    console.error('Searched paths:', possiblePaths);
    return null;
  }

  async createWindow() {
    // Check if already validated (for reopening)
    if (this.isValidated) {
      console.log('Already validated, launching app directly...');
      await this.launchProtectedExe();
      return;
    }

    console.log('Creating license validation window...');

    this.mainWindow = new BrowserWindow({
      width: 450,
      height: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      resizable: false,
      frame: true,
      title: 'License Verification',
      show: false,
      alwaysOnTop: true
    });

    await this.mainWindow.loadFile('index.html');
    
    // Show window after content is loaded
    this.mainWindow.show();
    this.mainWindow.center();

    // Handle window close
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      if (!this.isValidated) {
        console.log('License window closed without validation, exiting...');
        app.quit();
      }
    });

    console.log('License validation window created and shown');
  }

  // Extract embedded executable to temp location
  async extractEmbeddedExecutable() {
    if (!this.embeddedExePath) {
      throw new Error('No embedded executable found');
    }

    try {
      // Create temp directory with a more unique name
      const tempDir = path.join(os.tmpdir(), `protected_app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
      
      console.log('Creating temp directory:', tempDir);
      fs.mkdirSync(tempDir, { recursive: true });

      // Get original filename
      const originalName = path.basename(this.embeddedExePath);
      this.tempExePath = path.join(tempDir, originalName);

      console.log('Copying executable...');
      console.log('From:', this.embeddedExePath);
      console.log('To:', this.tempExePath);

      // Copy executable to temp location
      fs.copyFileSync(this.embeddedExePath, this.tempExePath);

      // Verify the copy was successful
      if (!fs.existsSync(this.tempExePath)) {
        throw new Error('Failed to copy executable to temp location');
      }

      const stats = fs.statSync(this.tempExePath);
      console.log(`✓ Extracted executable to temp (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
      
      return this.tempExePath;
    } catch (error) {
      console.error('Failed to extract embedded executable:', error);
      throw error;
    }
  }

  // Clean up temp files
  cleanupTempFiles() {
    if (this.tempExePath && fs.existsSync(this.tempExePath)) {
      try {
        const tempDir = path.dirname(this.tempExePath);
        
        // Add a small delay before cleanup to ensure the process has started
        setTimeout(() => {
          try {
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
              console.log('✓ Cleaned up temporary files');
            }
          } catch (error) {
            console.error('Failed to cleanup temp files:', error);
            // Try again after a longer delay
            setTimeout(() => {
              try {
                if (fs.existsSync(tempDir)) {
                  fs.rmSync(tempDir, { recursive: true, force: true });
                  console.log('✓ Cleaned up temporary files (second attempt)');
                }
              } catch (e) {
                console.error('Failed to cleanup temp files (second attempt):', e);
              }
            }, 5000);
          }
        }, 1000);
        
      } catch (error) {
        console.error('Failed to cleanup temp files:', error);
      }
    }
  }

  // Collect system fingerprint
  async getSystemFingerprint() {
    const fingerprint = {
      cpu: os.cpus()[0].model,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      totalMemory: os.totalmem(),
      networkInterfaces: this.getMacAddresses()
    };

    // Try to get motherboard info (Windows)
    if (process.platform === 'win32') {
      try {
        const mbInfo = await this.getMotherboardInfo();
        fingerprint.motherboard = mbInfo;
      } catch (error) {
        fingerprint.motherboard = 'unknown';
      }
    } else {
      fingerprint.motherboard = 'unknown';
    }

    return fingerprint;
  }

  getMacAddresses() {
    const interfaces = os.networkInterfaces();
    const macs = [];
    
    for (const interfaceName in interfaces) {
      const networkInterface = interfaces[interfaceName];
      if (networkInterface) {
        for (const addr of networkInterface) {
          if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            macs.push(addr.mac);
          }
        }
      }
    }
    
    return macs;
  }

  getMotherboardInfo() {
    return new Promise((resolve, reject) => {
      exec('wmic baseboard get serialnumber /value', (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          const match = stdout.match(/SerialNumber=(.+)/);
          resolve(match ? match[1].trim() : 'unknown');
        }
      });
    });
  }

  // Check server connectivity
  async checkServerHealth() {
    return new Promise((resolve) => {
      const url = `${this.serverUrl}/health`;
      const client = this.serverConfig.useHttps ? https : http;
      
      const request = client.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'License-Protection-Client/1.0'
        }
      }, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve({
              online: res.statusCode === 200,
              status: response.status,
              message: 'Server is reachable'
            });
          } catch (error) {
            resolve({
              online: false,
              message: 'Invalid server response'
            });
          }
        });
      });
      
      request.on('error', () => {
        resolve({
          online: false,
          message: 'Server is unreachable'
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        resolve({
          online: false,
          message: 'Server timeout'
        });
      });
    });
  }

  // Server-based license validation
  async validateWithServer(licenseKey, systemFingerprint) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        licenseKey,
        systemFingerprint
      });
      
      const url = new URL(`${this.serverUrl}/validate`);
      const client = this.serverConfig.useHttps ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'License-Protection-Client/1.0'
        },
        timeout: this.serverConfig.timeout
      };
      
      const request = client.request(options, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            
            if (res.statusCode === 200) {
              resolve({
                success: true,
                message: response.message,
                machineId: response.machineId,
                source: 'server'
              });
            } else {
              resolve({
                success: false,
                message: response.message || 'Server validation failed',
                source: 'server'
              });
            }
          } catch (error) {
            resolve({
              success: false,
              message: 'Invalid server response format',
              source: 'server'
            });
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('Server validation error:', error);
        resolve({
          success: false,
          message: 'Unable to connect to license server',
          source: 'server',
          offline: true
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        resolve({
          success: false,
          message: 'Server request timeout',
          source: 'server',
          offline: true
        });
      });
      
      request.write(postData);
      request.end();
    });
  }

  // Offline fallback validation
  async validateOffline(licenseKey, systemHash) {
    const offlineFile = path.join(__dirname, '.offline_licenses.dat');
    
    try {
      if (!fs.existsSync(offlineFile)) {
        return {
          success: false,
          message: 'No offline licenses available. Internet connection required.',
          source: 'offline'
        };
      }
      
      const encryptedData = fs.readFileSync(offlineFile, 'utf8');
      const decryptedData = this.decryptOfflineData(encryptedData);
      const offlineLicenses = JSON.parse(decryptedData);
      
      if (offlineLicenses[licenseKey] && offlineLicenses[licenseKey].systemHash === systemHash) {
        return {
          success: true,
          message: 'License validated offline',
          machineId: offlineLicenses[licenseKey].machineId,
          source: 'offline'
        };
      }
      
      return {
        success: false,
        message: 'License not found in offline cache',
        source: 'offline'
      };
      
    } catch (error) {
      console.error('Offline validation error:', error);
      return {
        success: false,
        message: 'Offline validation failed',
        source: 'offline'
      };
    }
  }

  // Save successful validation for offline use
  async saveOfflineLicense(licenseKey, systemHash, machineId) {
    const offlineFile = path.join(__dirname, '.offline_licenses.dat');
    
    try {
      let offlineLicenses = {};
      
      if (fs.existsSync(offlineFile)) {
        const encryptedData = fs.readFileSync(offlineFile, 'utf8');
        try {
          const decryptedData = this.decryptOfflineData(encryptedData);
          offlineLicenses = JSON.parse(decryptedData);
        } catch (error) {
          // If decryption fails, start fresh
          offlineLicenses = {};
        }
      }
      
      offlineLicenses[licenseKey] = {
        systemHash,
        machineId,
        validatedAt: Date.now()
      };
      
      const encryptedData = this.encryptOfflineData(JSON.stringify(offlineLicenses));
      fs.writeFileSync(offlineFile, encryptedData);
      
      console.log('✓ Saved license for offline use');
    } catch (error) {
      console.error('Failed to save offline license:', error);
    }
  }

  // Encryption for offline data
  encryptOfflineData(data) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update('OFFLINE_LICENSE_KEY_2024_SECURE').digest();
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  // Decryption for offline data
  decryptOfflineData(encryptedData) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update('OFFLINE_LICENSE_KEY_2024_SECURE').digest();
    
    const parts = encryptedData.split(':');
    if (parts.length !== 2) throw new Error('Invalid format');
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // Hash system fingerprint
  hashSystemFingerprint(fingerprint) {
    return crypto.createHash('sha256')
      .update(JSON.stringify(fingerprint) + 'SYSTEM_SALT_2024')
      .digest('hex');
  }

  // Main validation logic with server and offline fallback
  async validateAndLaunch(inputLicenseKey) {
    try {
      const licenseKey = inputLicenseKey.toUpperCase().trim();
      
      // Basic format validation
      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(licenseKey)) {
        return { 
          success: false, 
          message: 'Invalid license key format. Please use format: XXXX-XXXX-XXXX-XXXX' 
        };
      }

      // Get current system fingerprint
      const systemFingerprint = await this.getSystemFingerprint();
      const systemHash = this.hashSystemFingerprint(systemFingerprint);

      console.log('🔄 Validating license with server...');
      
      // Try server validation first
      const serverResult = await this.validateWithServer(licenseKey, systemFingerprint);
      
      if (serverResult.success) {
        console.log('✅ Server validation successful');
        
        // Save for offline use
        await this.saveOfflineLicense(licenseKey, systemHash, serverResult.machineId);
        
        // Mark as validated
        this.isValidated = true;

        // Launch the protected executable
        return await this.launchProtectedExe();
      }
      
      // If server validation failed but we're offline, try offline validation
      if (serverResult.offline) {
        console.log('🔄 Server offline, trying offline validation...');
        
        const offlineResult = await this.validateOffline(licenseKey, systemHash);
        
        if (offlineResult.success) {
          console.log('✅ Offline validation successful');
          
          // Mark as validated
          this.isValidated = true;

          // Launch the protected executable
          const launchResult = await this.launchProtectedExe();
          
          return {
            ...launchResult,
            message: launchResult.message + ' (Validated offline)',
            warning: 'Running in offline mode. Some features may be limited.'
          };
        }
        
        return {
          success: false,
          message: offlineResult.message + ' Please connect to the internet and try again.'
        };
      }
      
      // Server validation failed with specific error
      return serverResult;
      
    } catch (error) {
      console.error('Validation error:', error);
      return { 
        success: false, 
        message: 'An error occurred during validation: ' + error.message 
      };
    }
  }

  // Launch the protected executable
  async launchProtectedExe() {
    try {
      if (!this.embeddedExePath) {
        return { success: false, message: 'Protected application not found' };
      }

      console.log('🚀 Launching protected executable...');
      console.log('Source path:', this.embeddedExePath);

      // Extract executable to temp location
      const tempExePath = await this.extractEmbeddedExecutable();
      console.log('Temp path:', tempExePath);

      // Verify the extracted file exists and is accessible
      if (!fs.existsSync(tempExePath)) {
        throw new Error('Extracted executable not found');
      }

      // Copy any additional files that might be needed
      const sourceDir = path.dirname(this.embeddedExePath);
      const tempDir = path.dirname(tempExePath);
      
      try {
        const sourceFiles = fs.readdirSync(sourceDir);
        console.log('Files in source directory:', sourceFiles);
        
        // Copy any support files (DLLs, configs, etc.)
        const supportFiles = sourceFiles.filter(file => 
          file.toLowerCase().endsWith('.dll') || 
          file.toLowerCase().endsWith('.config') ||
          file.toLowerCase().endsWith('.json') ||
          file.toLowerCase().endsWith('.xml') ||
          (file.toLowerCase().endsWith('.exe') && file !== 'app.exe')
        );
        
        if (supportFiles.length > 0) {
          console.log('Copying support files:', supportFiles);
          for (const file of supportFiles) {
            const srcFile = path.join(sourceDir, file);
            const destFile = path.join(tempDir, file);
            if (fs.existsSync(srcFile)) {
              fs.copyFileSync(srcFile, destFile);
            }
          }
        }
      } catch (e) {
        console.log('Could not copy additional files:', e.message);
      }

      console.log('Launching:', tempExePath);

      // For console applications, we need to launch them properly
      if (process.platform === 'win32') {
        // Method 1: Try using Windows 'start' command to open in new console window
        console.log('Attempting to launch console application with new window...');
        
        const { exec } = require('child_process');
        
        const startCommand = `start "Protected Application" /wait "${tempExePath}"`;
        console.log('Executing:', startCommand);
        
        const child = exec(startCommand, {
          cwd: tempDir,
          windowsHide: false
        }, (error, stdout, stderr) => {
          if (error) {
            console.error('❌ Launch error:', error);
            setTimeout(() => this.cleanupTempFiles(), 5000);
          } else {
            console.log('✓ Application completed successfully');
            // Clean up after the application closes
            setTimeout(() => this.cleanupTempFiles(), 2000);
          }
        });

        child.on('exit', (code) => {
          console.log('Launch command exited with code:', code);
        });

        // Alternative method: Direct spawn with new console
        setTimeout(() => {
          console.log('Also trying direct spawn method...');
          
          const { spawn } = require('child_process');
          const directChild = spawn(tempExePath, [], {
            detached: true,
            stdio: 'ignore',
            cwd: tempDir,
            windowsHide: false,
            shell: false
          });

          directChild.on('spawn', () => {
            console.log('✓ Direct spawn successful, PID:', directChild.pid);
            directChild.unref(); // Allow process to run independently
          });

          directChild.on('error', (error) => {
            console.error('Direct spawn error:', error);
          });

        }, 1000);

      } else {
        // For non-Windows platforms, use terminal
        const { spawn } = require('child_process');
        const child = spawn('gnome-terminal', ['--', tempExePath], {
          detached: true,
          stdio: 'ignore',
          cwd: tempDir
        });
        
        child.unref();
      }

      // Close the license window after launching
      setTimeout(() => {
        if (this.mainWindow) {
          console.log('Closing license window...');
          this.mainWindow.close();
          this.mainWindow = null;
        }
        
        // Exit the protection layer after a delay
        setTimeout(() => {
          console.log('Protection layer exiting (application should now be running independently)...');
          app.quit();
        }, 3000);
      }, 2000);

      return { success: true, message: 'Application launched successfully' };

    } catch (error) {
      console.error('Launch error:', error);
      this.cleanupTempFiles();
      return { success: false, message: 'Failed to launch application: ' + error.message };
    }
  }

  // Setup IPC handlers
  setupIPC() {
    ipcMain.handle('validate-license', async (event, licenseKey) => {
      return await this.validateAndLaunch(licenseKey);
    });

    ipcMain.handle('get-system-info', async () => {
      const fingerprint = await this.getSystemFingerprint();
      return {
        cpu: fingerprint.cpu,
        platform: fingerprint.platform,
        hostname: fingerprint.hostname
      };
    });

    ipcMain.handle('check-server-status', async () => {
      return await this.checkServerHealth();
    });
  }

  // Initialize the protection layer
  async init() {
    // Check if embedded executable exists
    if (!this.embeddedExePath) {
      console.error('❌ No embedded executable found!');
      dialog.showErrorBox(
        'Application Error', 
        'Protected application not found. Please reinstall the application.'
      );
      app.quit();
      return;
    }
    
    this.setupIPC();
    await this.createWindow();
  }
}

// Initialize app
const protection = new ProtectionLayer();

app.whenReady().then(async () => {
  await protection.init();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    protection.cleanupTempFiles();
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await protection.createWindow();
  }
});

// Cleanup on app termination
app.on('before-quit', () => {
  protection.cleanupTempFiles();
});