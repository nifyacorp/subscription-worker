const fs = require('fs');
const path = require('path');

// Directories to create relative to the workspace root
const dirsToCreate = [
    'src/repositories',
    'src/services',
    'src/clients',
    'src/controllers' // Adding controllers directory for API logic
];

// Workspace root path (assuming script is run from workspace root)
const workspaceRoot = __dirname; // Adjust if the script location differs

dirsToCreate.forEach(relativeDir => {
    const fullPath = path.join(workspaceRoot, relativeDir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Created directory: ${fullPath}`);
    } else {
        console.log(`Directory already exists: ${fullPath}`);
    }
});

console.log('Directory structure setup complete.'); 