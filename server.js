// server.js - License Server API with MongoDB
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/license-protection';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Strict rate limiting for validation
const validationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 validation requests per minute
  message: 'Too many validation attempts, please try again later.'
});

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB');
  initializeDefaultKeys();
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// License Schema
const licenseSchema = new mongoose.Schema({
  licenseKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  isActivated: {
    type: Boolean,
    default: false,
    index: true
  },
  systemFingerprint: {
    type: String,
    default: null
  },
  machineId: {
    type: String,
    default: null
  },
  activatedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastValidated: {
    type: Date,
    default: null
  },
  validationCount: {
    type: Number,
    default: 0
  },
  metadata: {
    ip: String,
    userAgent: String,
    hostname: String,
    platform: String
  }
}, {
  timestamps: true
});

// Add compound index for better performance
licenseSchema.index({ licenseKey: 1, isActivated: 1 });
licenseSchema.index({ systemFingerprint: 1, isActivated: 1 });

const License = mongoose.model('License', licenseSchema);

// Admin Schema (for API access)
const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  apiKey: {
    type: String,
    required: true,
    unique: true
  },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'admin']
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Admin = mongoose.model('Admin', adminSchema);

// Utility Functions
function generateLicenseKey() {
  // Generate a strong license key: 4 groups of 4 alphanumeric characters
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  
  for (let i = 0; i < 4; i++) {
    if (i > 0) key += '-';
    for (let j = 0; j < 4; j++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  
  return key;
}

function generateUniqueKeys(count) {
  const keys = new Set();
  
  while (keys.size < count) {
    keys.add(generateLicenseKey());
  }
  
  return Array.from(keys);
}

function hashSystemFingerprint(fingerprint) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(fingerprint) + 'SALT_2024_SECURE')
    .digest('hex');
}

function generateMachineId() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// Initialize default license keys
async function initializeDefaultKeys() {
  try {
    const existingCount = await License.countDocuments();
    
    if (existingCount === 0) {
      console.log('🔄 Generating initial license keys...');
      
      const keys = generateUniqueKeys(1000);
      const licenses = keys.map(key => ({
        licenseKey: key
      }));
      
      await License.insertMany(licenses);
      console.log(`✅ Generated ${keys.length} license keys`);
      
      // Display first 10 keys for testing
      console.log('\n📋 First 10 license keys for testing:');
      keys.slice(0, 10).forEach((key, index) => {
        console.log(`${index + 1}: ${key}`);
      });
      
    } else {
      console.log(`📊 Found ${existingCount} existing license keys in database`);
    }
    
    // Create default admin if none exists
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const defaultPassword = 'admin123!';
      const passwordHash = await bcrypt.hash(defaultPassword, 12);
      const apiKey = crypto.randomBytes(32).toString('hex');
      
      await Admin.create({
        username: 'admin',
        passwordHash,
        apiKey,
        permissions: ['read', 'write', 'admin']
      });
      
      console.log('✅ Created default admin user');
      console.log(`   Username: admin`);
      console.log(`   Password: ${defaultPassword}`);
      console.log(`   API Key: ${apiKey}`);
    }
    
  } catch (error) {
    console.error('❌ Error initializing keys:', error);
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: 'License Protection Server',
    version: '1.0.0'
  });
});

// License validation endpoint
app.post('/api/validate', validationLimiter, async (req, res) => {
  try {
    const { licenseKey, systemFingerprint } = req.body;
    
    if (!licenseKey || !systemFingerprint) {
      return res.status(400).json({
        success: false,
        message: 'License key and system fingerprint are required'
      });
    }
    
    // Hash the system fingerprint for privacy
    const hashedFingerprint = hashSystemFingerprint(systemFingerprint);
    
    // Find the license
    const license = await License.findOne({ licenseKey: licenseKey.toUpperCase() });
    
    if (!license) {
      return res.status(404).json({
        success: false,
        message: 'Invalid license key'
      });
    }
    
    // Check if license is already activated on a different machine
    if (license.isActivated && license.systemFingerprint !== hashedFingerprint) {
      return res.status(409).json({
        success: false,
        message: `This license is already activated on machine ${license.machineId}. Each license can only be used on one computer.`
      });
    }
    
    // If license is already activated on this machine, allow re-validation
    if (license.isActivated && license.systemFingerprint === hashedFingerprint) {
      // Update last validation
      await License.updateOne(
        { _id: license._id },
        { 
          lastValidated: new Date(),
          $inc: { validationCount: 1 }
        }
      );
      
      return res.json({
        success: true,
        message: 'License validated successfully',
        machineId: license.machineId,
        activatedAt: license.activatedAt
      });
    }
    
    // First time activation
    if (!license.isActivated) {
      const machineId = generateMachineId();
      
      await License.updateOne(
        { _id: license._id },
        {
          isActivated: true,
          systemFingerprint: hashedFingerprint,
          machineId: machineId,
          activatedAt: new Date(),
          lastValidated: new Date(),
          $inc: { validationCount: 1 },
          metadata: {
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            hostname: systemFingerprint.hostname,
            platform: systemFingerprint.platform
          }
        }
      );
      
      console.log(`✅ License activated: ${licenseKey} -> Machine ${machineId}`);
      
      return res.json({
        success: true,
        message: 'License activated successfully',
        machineId: machineId,
        activatedAt: new Date()
      });
    }
    
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during validation'
    });
  }
});

// Admin middleware
async function requireAdmin(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  try {
    const admin = await Admin.findOne({ apiKey });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Admin: Get all licenses with pagination
app.get('/api/admin/licenses', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    const filter = {};
    if (req.query.activated === 'true') filter.isActivated = true;
    if (req.query.activated === 'false') filter.isActivated = false;
    
    const [licenses, total] = await Promise.all([
      License.find(filter)
        .select('-systemFingerprint') // Hide sensitive data
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      License.countDocuments(filter)
    ]);
    
    res.json({
      licenses,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: licenses.length,
        totalRecords: total
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Generate new license keys
app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  try {
    const count = parseInt(req.body.count) || 100;
    
    if (count > 10000) {
      return res.status(400).json({ error: 'Cannot generate more than 10,000 keys at once' });
    }
    
    const keys = generateUniqueKeys(count);
    const licenses = keys.map(key => ({
      licenseKey: key
    }));
    
    await License.insertMany(licenses);
    
    console.log(`✅ Admin generated ${count} new license keys`);
    
    res.json({
      success: true,
      message: `Generated ${count} new license keys`,
      keys: keys
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Revoke license
app.post('/api/admin/revoke', requireAdmin, async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    const result = await License.updateOne(
      { licenseKey: licenseKey.toUpperCase() },
      {
        isActivated: false,
        systemFingerprint: null,
        machineId: null,
        activatedAt: null
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'License key not found' });
    }
    
    res.json({
      success: true,
      message: 'License revoked successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get statistics
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [total, activated, recent] = await Promise.all([
      License.countDocuments(),
      License.countDocuments({ isActivated: true }),
      License.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
    ]);
    
    res.json({
      total,
      activated,
      available: total - activated,
      recentActivations: recent,
      activationRate: total > 0 ? (activated / total * 100).toFixed(2) + '%' : '0%'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down server...');
  
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 License Protection Server running on port ${PORT}`);
  console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`📊 MongoDB: ${MONGODB_URI}`);
  console.log('');
});

module.exports = app;