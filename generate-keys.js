#!/usr/bin/env node
// generate-keys.js - Interactive license key generator
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class KeyGenerator {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.serverConfig = {
      host: process.env.LICENSE_SERVER_HOST || 'localhost',
      port: process.env.LICENSE_SERVER_PORT || 3000,
      useHttps: process.env.USE_HTTPS === 'true' || false,
      apiKey: process.env.ADMIN_API_KEY || ''
    };
    
    this.serverUrl = `${this.serverConfig.useHttps ? 'https' : 'http'}://${this.serverConfig.host}:${this.serverConfig.port}/api`;
  }

  async run() {
    console.log('🔑 License Key Generator');
    console.log('========================\n');
    
    try {
      // Check server connection
      console.log('🔍 Checking server connection...');
      const serverStatus = await this.checkServerHealth();
      
      if (!serverStatus.online) {
        console.log('❌ Server is not reachable.');
        console.log(`   Error: ${serverStatus.message}`);
        console.log(`   Server URL: ${this.serverUrl}`);
        console.log('\n💡 Make sure the license server is running:');
        console.log('   npm run server\n');
        
        const continueOffline = await this.askQuestion('Generate keys offline instead? (y/N): ');
        if (continueOffline.toLowerCase() !== 'y') {
          process.exit(1);
        }
        
        await this.generateOfflineKeys();
        return;
      }
      
      console.log('✅ Server is online');
      
      // Check if we have admin API key
      if (!this.serverConfig.apiKey) {
        console.log('\n🔐 Admin API Key Required');
        this.serverConfig.apiKey = await this.askQuestion('Enter admin API key: ');
      }
      
      // Show menu
      await this.showMenu();
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  async showMenu() {
    while (true) {
      console.log('\n📋 Available Actions:');
      console.log('1. Generate new license keys');
      console.log('2. View license statistics');
      console.log('3. Export all keys to file');
      console.log('4. Revoke a license key');
      console.log('5. Check specific license');
      console.log('6. Exit');
      
      const choice = await this.askQuestion('\nSelect an option (1-6): ');
      
      switch (choice) {
        case '1':
          await this.generateKeys();
          break;
        case '2':
          await this.showStatistics();
          break;
        case '3':
          await this.exportKeys();
          break;
        case '4':
          await this.revokeKey();
          break;
        case '5':
          await this.checkLicense();
          break;
        case '6':
          console.log('\n👋 Goodbye!');
          return;
        default:
          console.log('❌ Invalid option. Please select 1-6.');
      }
    }
  }

  async generateKeys() {
    console.log('\n🎯 Generate New License Keys');
    console.log('============================');
    
    const countStr = await this.askQuestion('How many keys to generate? (1-1000): ');
    const count = parseInt(countStr);
    
    if (isNaN(count) || count < 1 || count > 1000) {
      console.log('❌ Invalid count. Please enter a number between 1 and 1000.');
      return;
    }
    
    console.log(`\n🔄 Generating ${count} license keys...`);
    
    try {
      const response = await this.makeApiRequest('/admin/generate', 'POST', {
        count: count
      });
      
      console.log(`✅ Successfully generated ${count} license keys!`);
      
      const saveToFile = await this.askQuestion('\nSave keys to file? (Y/n): ');
      if (saveToFile.toLowerCase() !== 'n') {
        await this.saveKeysToFile(response.keys);
      }
      
      const showKeys = await this.askQuestion('Display generated keys? (y/N): ');
      if (showKeys.toLowerCase() === 'y') {
        console.log('\n📋 Generated License Keys:');
        console.log('==========================');
        response.keys.forEach((key, index) => {
          console.log(`${String(index + 1).padStart(3)}: ${key}`);
        });
      }
      
    } catch (error) {
      console.log('❌ Failed to generate keys:', error.message);
    }
  }

  async showStatistics() {
    console.log('\n📊 License Statistics');
    console.log('====================');
    
    try {
      const stats = await this.makeApiRequest('/admin/stats', 'GET');
      
      console.log(`Total Keys:           ${stats.total.toLocaleString()}`);
      console.log(`Activated Keys:       ${stats.activated.toLocaleString()}`);
      console.log(`Available Keys:       ${stats.available.toLocaleString()}`);
      console.log(`Activation Rate:      ${stats.activationRate}`);
      console.log(`Recent Activations:   ${stats.recentActivations.toLocaleString()}`);
      
    } catch (error) {
      console.log('❌ Failed to get statistics:', error.message);
    }
  }

  async exportKeys() {
    console.log('\n📁 Export License Keys');
    console.log('======================');
    
    const filterStr = await this.askQuestion('Export filter (all/activated/available): ');
    const filter = filterStr.toLowerCase();
    
    if (!['all', 'activated', 'available'].includes(filter)) {
      console.log('❌ Invalid filter. Use: all, activated, or available');
      return;
    }
    
    try {
      console.log('🔄 Fetching license data...');
      
      let allLicenses = [];
      let page = 1;
      const limit = 100;
      
      while (true) {
        const queryParams = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString()
        });
        
        if (filter === 'activated') {
          queryParams.set('activated', 'true');
        } else if (filter === 'available') {
          queryParams.set('activated', 'false');
        }
        
        const response = await this.makeApiRequest(`/admin/licenses?${queryParams}`, 'GET');
        
        allLicenses.push(...response.licenses);
        
        if (response.licenses.length < limit) {
          break; // Last page
        }
        
        page++;
      }
      
      const filename = `license_keys_${filter}_${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join(process.cwd(), filename);
      
      fs.writeFileSync(filepath, JSON.stringify(allLicenses, null, 2));
      
      console.log(`✅ Exported ${allLicenses.length} licenses to: ${filepath}`);
      
    } catch (error) {
      console.log('❌ Failed to export keys:', error.message);
    }
  }

  async revokeKey() {
    console.log('\n🚫 Revoke License Key');
    console.log('====================');
    
    const licenseKey = await this.askQuestion('Enter license key to revoke: ');
    
    if (!this.validateKeyFormat(licenseKey)) {
      console.log('❌ Invalid license key format. Use format: XXXX-XXXX-XXXX-XXXX');
      return;
    }
    
    const confirm = await this.askQuestion(`⚠️  Are you sure you want to revoke ${licenseKey}? (y/N): `);
    if (confirm.toLowerCase() !== 'y') {
      console.log('Revocation cancelled.');
      return;
    }
    
    try {
      await this.makeApiRequest('/admin/revoke', 'POST', {
        licenseKey: licenseKey
      });
      
      console.log(`✅ License key ${licenseKey} has been revoked successfully.`);
      
    } catch (error) {
      console.log('❌ Failed to revoke key:', error.message);
    }
  }

  async checkLicense() {
    console.log('\n🔍 Check License Key');
    console.log('===================');
    
    const licenseKey = await this.askQuestion('Enter license key to check: ');
    
    if (!this.validateKeyFormat(licenseKey)) {
      console.log('❌ Invalid license key format. Use format: XXXX-XXXX-XXXX-XXXX');
      return;
    }
    
    try {
      const response = await this.makeApiRequest(`/admin/licenses?limit=1`, 'GET');
      
      // Find the specific license (this is a simplified search)
      console.log('🔄 Searching for license...');
      
      // In a real implementation, you'd want a specific endpoint for this
      console.log('💡 Note: Implement specific license lookup endpoint for better performance');
      
    } catch (error) {
      console.log('❌ Failed to check license:', error.message);
    }
  }

  async generateOfflineKeys() {
    console.log('\n💻 Offline Key Generation');
    console.log('=========================');
    
    const countStr = await this.askQuestion('How many keys to generate? (1-10000): ');
    const count = parseInt(countStr);
    
    if (isNaN(count) || count < 1 || count > 10000) {
      console.log('❌ Invalid count. Please enter a number between 1 and 10000.');
      return;
    }
    
    console.log(`\n🔄 Generating ${count} license keys offline...`);
    
    const keys = this.generateUniqueKeys(count);
    
    console.log(`✅ Generated ${count} license keys offline!`);
    
    await this.saveKeysToFile(keys);
    
    const showSample = await this.askQuestion('Show first 10 keys? (Y/n): ');
    if (showSample.toLowerCase() !== 'n') {
      console.log('\n📋 Sample License Keys:');
      console.log('=======================');
      keys.slice(0, 10).forEach((key, index) => {
        console.log(`${String(index + 1).padStart(2)}: ${key}`);
      });
      
      if (keys.length > 10) {
        console.log(`... and ${keys.length - 10} more keys saved to file`);
      }
    }
    
    console.log('\n💡 Note: These keys are generated offline and not stored in the database.');
    console.log('    You\'ll need to add them to your server database manually.');
  }

  generateUniqueKeys(count) {
    const keys = new Set();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    
    while (keys.size < count) {
      let key = '';
      for (let i = 0; i < 4; i++) {
        if (i > 0) key += '-';
        for (let j = 0; j < 4; j++) {
          key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }
      keys.add(key);
    }
    
    return Array.from(keys);
  }

  async saveKeysToFile(keys) {
    const filename = `license_keys_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const filepath = path.join(process.cwd(), filename);
    
    const content = [
      '# License Keys Generated on ' + new Date().toLocaleString(),
      '# Total Keys: ' + keys.length,
      '# Format: XXXX-XXXX-XXXX-XXXX',
      '',
      ...keys
    ].join('\n');
    
    fs.writeFileSync(filepath, content);
    console.log(`💾 Keys saved to: ${filepath}`);
  }

  validateKeyFormat(key) {
    return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key.toUpperCase());
  }

  async checkServerHealth() {
    return new Promise((resolve) => {
      const url = `${this.serverUrl}/health`;
      const client = this.serverConfig.useHttps ? https : http;
      
      const request = client.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'License-Key-Generator/1.0'
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
      
      request.on('error', (error) => {
        resolve({
          online: false,
          message: `Connection error: ${error.message}`
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        resolve({
          online: false,
          message: 'Connection timeout'
        });
      });
    });
  }

  async makeApiRequest(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.serverUrl + endpoint);
      const client = this.serverConfig.useHttps ? https : http;
      
      const postData = data ? JSON.stringify(data) : null;
      
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'License-Key-Generator/1.0',
          'X-API-Key': this.serverConfig.apiKey
        },
        timeout: 30000
      };
      
      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }
      
      const request = client.request(options, (res) => {
        let responseData = '';
        
        res.on('data', chunk => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(responseData);
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsedData);
            } else {
              reject(new Error(parsedData.error || parsedData.message || 'Request failed'));
            }
          } catch (error) {
            reject(new Error('Invalid JSON response from server'));
          }
        });
      });
      
      request.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (postData) {
        request.write(postData);
      }
      
      request.end();
    });
  }

  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  process.exit(0);
});

// Run the key generator
if (require.main === module) {
  const generator = new KeyGenerator();
  generator.run().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = KeyGenerator;