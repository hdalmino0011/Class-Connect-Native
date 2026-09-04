const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// JSON and URL-encoded body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static assets from root directory
app.use(express.static(__dirname));

// Safe runtime configuration endpoint
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "https://uctodqnrwrroppkaggbl.supabase.co",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdG9kcW5yd3Jyb3Bwa2FnZ2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2ODk0NDYsImV4cCI6MjEwMTI2NTQ0Nn0.EwFU5LmczD8PLLeV0jTFvWxnuMzL65xy_zpkZEAV3NA"
  });
});

app.get('/api/config.js', (req, res) => {
  res.type('application/javascript');
  const cfg = {
    supabaseUrl: process.env.SUPABASE_URL || "https://uctodqnrwrroppkaggbl.supabase.co",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdG9kcW5yd3Jyb3Bwa2FnZ2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2ODk0NDYsImV4cCI6MjEwMTI2NTQ0Nn0.EwFU5LmczD8PLLeV0jTFvWxnuMzL65xy_zpkZEAV3NA"
  };
  res.send(`window.__CONFIG__ = ${JSON.stringify(cfg)};`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/app-version', (req, res) => {
  try {
    const versionPath = path.join(__dirname, 'version.json');
    if (fs.existsSync(versionPath)) {
      const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      return res.json(data);
    }
    return res.json({
      version: '1.1.0',
      versionCode: 3,
      releaseDate: '2026-09-03',
      releaseNotes: ['Stability improvements', 'In-app updater', 'Schedule reminders']
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single page application fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`ClassConnect server listening on http://${HOST}:${PORT}`);
});
