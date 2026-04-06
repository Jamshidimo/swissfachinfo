/**
 * Download import files from Google Drive into ./data/
 * Usage: npm run download
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const DATA_DIR = path.resolve('data');

// Google Drive file IDs (extracted from sharing links)
const FILES = [
  {
    name: 'aips_db.sqlite',
    // https://drive.google.com/file/d/1amlZUNbpc8B4kpCo3Hd91qDuyza5olV0/view
    fileId: '1amlZUNbpc8B4kpCo3Hd91qDuyza5olV0',
  },
  {
    name: 'aips_xml.xml',
    // https://drive.google.com/file/d/129FpUXoxjkYQ1JoMnMCJVIt2VRHDzuIx/view
    fileId: '129FpUXoxjkYQ1JoMnMCJVIt2VRHDzuIx',
  },
];

function followRedirects(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`  Redirecting...`);
        followRedirects(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      let downloaded = 0;
      const totalSize = parseInt(res.headers['content-length'] || '0', 10);

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const pct = ((downloaded / totalSize) * 100).toFixed(1);
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${mb} MB (${pct}%)`);
        } else {
          process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('');
        resolve();
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFromGoogleDrive(fileId: string, dest: string): Promise<void> {
  // For large files, Google Drive requires a confirmation token
  // First try direct download
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  console.log(`  Trying direct download...`);

  // Use confirm=t to bypass the virus scan warning for large files
  const confirmedUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
  await followRedirects(confirmedUrl, dest);
}

async function main() {
  // Create data directory
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const file of FILES) {
    const dest = path.join(DATA_DIR, file.name);

    if (fs.existsSync(dest)) {
      const size = fs.statSync(dest).size;
      console.log(`${file.name} already exists (${(size / 1024 / 1024).toFixed(1)} MB), skipping.`);
      continue;
    }

    console.log(`Downloading ${file.name}...`);
    try {
      await downloadFromGoogleDrive(file.fileId, dest);
      const size = fs.statSync(dest).size;
      console.log(`  Done: ${(size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      console.error(`  Failed: ${err}`);
      // Clean up partial file
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      process.exit(1);
    }
  }

  console.log('\nAll files downloaded to ./data/');
}

main();
