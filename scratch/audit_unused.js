const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const ignoreDirs = ['node_modules', '.git', 'public', 'assets', 'uploads', 'scratch', 'coverage', 'logs'];

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (ignoreDirs.includes(file)) continue;
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.js') && !file.endsWith('.test.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allJsFiles = getAllFiles(projectRoot);
const referencedFiles = new Set();
const unresolvedRequires = new Set();

const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

for (const file of allJsFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      // Local file require
      let resolvedPath = path.resolve(path.dirname(file), importPath);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
         resolvedPath = path.join(resolvedPath, 'index.js');
      }
      if (!resolvedPath.endsWith('.js')) {
        resolvedPath += '.js';
      }
      if (fs.existsSync(resolvedPath)) {
        referencedFiles.add(resolvedPath);
      } else {
        let tryIndex = path.join(path.resolve(path.dirname(file), importPath), 'index.js');
        if (fs.existsSync(tryIndex)) {
            referencedFiles.add(tryIndex);
        } else {
            unresolvedRequires.add(importPath + ' in ' + file);
        }
      }
    }
  }
}

// Add entry points
referencedFiles.add(path.join(projectRoot, 'server.js'));

const unusedFiles = allJsFiles.filter(f => !referencedFiles.has(f) && !f.includes('test') && !f.includes('seed') && !f.includes('script') && !f.includes('migrate'));
console.log('--- Unused Files ---');
unusedFiles.forEach(f => console.log(f.replace(projectRoot, '')));

console.log('\n--- Unresolved Requires ---');
unresolvedRequires.forEach(r => console.log(r));
