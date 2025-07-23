// debug-paths.js - Run this to debug path issues
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

console.log('=== DEBUG PATH INFORMATION ===');
console.log('app.isPackaged:', app.isPackaged);
console.log('__dirname:', __dirname);
console.log('process.resourcesPath:', process.resourcesPath);
console.log('process.cwd():', process.cwd());
console.log('app.getAppPath():', app.getAppPath());

console.log('\n=== CHECKING PATHS ===');

// Development mode paths
const devPaths = [
    path.join(__dirname, 'embedded', 'app.exe'),
    path.join(__dirname, 'resources', 'app.exe'),
    path.join(__dirname, 'app.exe')
];

// Production mode paths  
const prodPaths = [
    path.join(process.resourcesPath, 'app.exe'),
    path.join(process.resourcesPath, 'embedded', 'app.exe'),
    path.join(__dirname, '..', 'app.exe'),
    path.join(__dirname, '..', '..', 'resources', 'app.exe'),
    path.join(process.resourcesPath, '..', 'app.exe')
];

const allPaths = [...devPaths, ...prodPaths];

allPaths.forEach(testPath => {
    const exists = fs.existsSync(testPath);
    console.log(`${exists ? '✓' : '✗'} ${testPath}`);
    
    if (exists) {
        try {
            const stats = fs.statSync(testPath);
            console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (e) {
            console.log(`  Error reading stats: ${e.message}`);
        }
    }
});

console.log('\n=== DIRECTORY LISTINGS ===');

// List contents of key directories
const dirsToCheck = [
    __dirname,
    process.resourcesPath || 'N/A',
    path.join(__dirname, 'embedded'),
    path.join(__dirname, '..'),
];

dirsToCheck.forEach(dir => {
    console.log(`\nContents of: ${dir}`);
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const isDir = fs.statSync(filePath).isDirectory();
                console.log(`  ${isDir ? '[DIR]' : '[FILE]'} ${file}`);
            });
        } else {
            console.log('  Directory does not exist');
        }
    } catch (e) {
        console.log(`  Error reading directory: ${e.message}`);
    }
});

app.quit();