const fs = require('fs');
const path = require('path');

const targets = [
  path.join(__dirname, 'www'),
  path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'public')
];

targets.forEach(targetDir => {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
});

const filesToCopy = [
  'index.html',
  'style.css',
  'script.js',
  'sw.js',
  'manifest.json',
  'version.json',
  'logo.png',
  'gcashQR.jpg',
  'gotymeQR.jpg',
  'maribankQR.jpg',
  'pdf.min.js',
  'pdf.worker.min.js'
];

filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  if (fs.existsSync(src)) {
    targets.forEach(targetDir => {
      const dest = path.join(targetDir, file);
      fs.copyFileSync(src, dest);
    });
  }
});

console.log('✓ Successfully synchronized web assets to www and android assets for Native build.');
