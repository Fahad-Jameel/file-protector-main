// scripts/prepare-executable.js
// Script to prepare your executable for embedding

const fs = require('fs');
const path = require('path');

const SOURCE_EXE_PATH = path.join(__dirname, '..', 'original-exe');  // Put your exe here
const EMBEDDED_DIR = path.join(__dirname, '..', 'embedded');

function prepareExecutable() {
    console.log('🔧 Preparing executable for embedding...');
    
    // Create embedded directory if it doesn't exist
    if (!fs.existsSync(EMBEDDED_DIR)) {
        fs.mkdirSync(EMBEDDED_DIR, { recursive: true });
        console.log('✓ Created embedded directory');
    }
    
    // Look for executable files in the source directory
    if (!fs.existsSync(SOURCE_EXE_PATH)) {
        console.error('❌ Source executable directory not found!');
        console.log(`Please create the directory: ${SOURCE_EXE_PATH}`);
        console.log('And place your .exe file there (rename it to app.exe)');
        
        // Create the directory for convenience
        fs.mkdirSync(SOURCE_EXE_PATH, { recursive: true });
        console.log(`✓ Created directory: ${SOURCE_EXE_PATH}`);
        console.log('Now place your .exe file there and rename it to app.exe');
        
        return false;
    }
    
    const files = fs.readdirSync(SOURCE_EXE_PATH);
    const exeFiles = files.filter(file => file.toLowerCase().endsWith('.exe'));
    
    if (exeFiles.length === 0) {
        console.error('❌ No .exe files found in original-exe directory!');
        console.log(`Files found in ${SOURCE_EXE_PATH}:`);
        files.forEach(file => console.log(`  - ${file}`));
        console.log('\nPlease place your executable file in the original-exe directory');
        console.log('and make sure it has a .exe extension');
        return false;
    }
    
    // Use the first exe file found, or look for app.exe specifically
    let sourceExe = exeFiles.find(file => file.toLowerCase() === 'app.exe') || exeFiles[0];
    const sourcePath = path.join(SOURCE_EXE_PATH, sourceExe);
    const targetPath = path.join(EMBEDDED_DIR, 'app.exe');
    
    try {
        // Copy the executable
        fs.copyFileSync(sourcePath, targetPath);
        
        const sourceStats = fs.statSync(sourcePath);
        const targetStats = fs.statSync(targetPath);
        const fileSizeMB = (targetStats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✓ Successfully embedded ${sourceExe} as app.exe`);
        console.log(`  Source: ${sourcePath} (${(sourceStats.size / (1024 * 1024)).toFixed(2)}MB)`);
        console.log(`  Target: ${targetPath} (${fileSizeMB}MB)`);
        
        // Verify the copy
        if (sourceStats.size !== targetStats.size) {
            console.error('❌ File size mismatch after copy!');
            return false;
        }
        
        console.log('✅ File integrity verified - sizes match');
        return true;
        
    } catch (error) {
        console.error('❌ Failed to copy executable:', error.message);
        console.error('Make sure the file is not currently running or locked');
        return false;
    }
}

if (require.main === module) {
    const success = prepareExecutable();
    if (success) {
        console.log('✅ Executable preparation completed!');
        console.log('You can now run: npm run build');
    } else {
        console.log('❌ Executable preparation failed!');
        console.log('Please fix the issues above and try again.');
        process.exit(1);
    }
}

module.exports = { prepareExecutable };