import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');
const configPath = path.join(rootDir, '.qa_test_emails.json');

let emails = {
  USER_A_EMAIL: "user_a@example.com",
  USER_B_EMAIL: "user_b@example.com"
};

if (fs.existsSync(configPath)) {
  const fileContent = fs.readFileSync(configPath, 'utf8');
  emails = { ...emails, ...JSON.parse(fileContent) };
}

export const USER_A_EMAIL = emails.USER_A_EMAIL;
export const USER_B_EMAIL = emails.USER_B_EMAIL;
export const PROXY_API_KEY = process.env.PROXY_API_KEY || '';

// ROOT_URL is the domain the Google SDK will use as rootUrl.
// The SDK appends /gmail/v1/ automatically — any path in rootUrl gets stripped.
// For local dev: http://localhost:3000 (middleware rewrites /gmail/v1/* → /api/proxy/gmail/v1/*)
// For production: https://gmail.fgac.ai (subdomain routing handles the rewrite)
export const ROOT_URL = process.env.FGAC_ROOT_URL || 'https://gmail.fgac.ai';
