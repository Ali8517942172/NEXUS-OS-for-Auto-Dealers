const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const N8N_API_KEY = process.env.N8N_MCP_API_KEY;

// Base URL of the live n8n instance. Default is the GCP VM `nexus-vm`.
// TAILSCALE_N8N_URL is the old name from when n8n ran on the Windows desktop
// behind a Tailscale funnel; it is still read so existing .env files keep
// working, but it is deprecated — set N8N_BASE_URL instead.
const DEFAULT_N8N_BASE_URL = 'https://35.224.126.225.nip.io';
const N8N_BASE_URL =
    process.env.N8N_BASE_URL ||
    process.env.TAILSCALE_N8N_URL ||
    DEFAULT_N8N_BASE_URL;

if (!N8N_BASE_URL || typeof N8N_BASE_URL !== 'string' || !N8N_BASE_URL.trim()) {
    console.error(
        'deploy_n8n: no n8n base URL. Set N8N_BASE_URL in .env, e.g.\n' +
        '  N8N_BASE_URL=' + DEFAULT_N8N_BASE_URL
    );
    process.exit(1);
}

// https.request wants a bare hostname, not a URL.
const N8N_URL = N8N_BASE_URL.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const workflowsDir = path.join(__dirname, '../n8n-workflows');

async function pushWorkflow(filename) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(workflowsDir, filename);
        const workflowJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Strip read-only fields for n8n API
        delete workflowJson.id;
        delete workflowJson.active;
        delete workflowJson.createdAt;
        delete workflowJson.updatedAt;
        delete workflowJson.tags;
        delete workflowJson.versionId;
        delete workflowJson.meta;
        
        const payload = JSON.stringify(workflowJson);
        
        const options = {
            hostname: N8N_URL,
            path: '/api/v1/workflows',
            method: 'POST',
            headers: {
                'X-N8N-API-KEY': N8N_API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`[SUCCESS] Deployed ${filename}`);
                    resolve(data);
                } else {
                    console.error(`[FAILED] ${filename} - HTTP ${res.statusCode}: ${data}`);
                    resolve(null); // Resolve anyway to continue loop
                }
            });
        });

        req.on('error', (e) => {
            console.error(`[ERROR] ${filename} connection failed:`, e.message);
            resolve(null);
        });

        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log("Starting n8n deployment...");
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        console.log(`Deploying ${file}...`);
        await pushWorkflow(file);
    }
    console.log("Deployment complete.");
}

main();
