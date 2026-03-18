import { config } from 'dotenv';
config({ path: '.env.preview' }); // Load preview envs including bypass secret

const PROXY_URL = 'https://fine-grain-access-control-kim79wcxk-kenyesh-gmailcoms-projects.vercel.app/api/proxy';
const PROXY_KEY = process.env.QA_TEST_03_KEY || 'sk_proxy_TEST_KEY_HERE';
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!BYPASS_SECRET) {
  console.error("❌ VERCEL_AUTOMATION_BYPASS_SECRET is missing.");
  console.error("Please ensure you have generated it in Vercel Deployment Protection settings and added it to .env.preview");
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${PROXY_KEY}`,
  'Content-Type': 'application/json',
  'x-vercel-protection-bypass': BYPASS_SECRET
};

async function testEndpoint(endpoint: string, method: string = 'GET') {
  console.log(`\nTesting ${method} ${endpoint}...`);
  try {
    const res = await fetch(`${PROXY_URL}${endpoint}`, { method, headers });
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text.substring(0, 150).replace(/\n/g, '')}...`);
    return { status: res.status, text };
  } catch (err) {
    console.error(`Fetch Error:`, err);
    return { status: 500, text: String(err) };
  }
}

async function run() {
  console.log("🚀 Starting API Tests against Vercel Preview (Bypassing Protection)");
  
  // Test basic proxy liveness
  await testEndpoint('/gmail/v1/users/me/profile');
  
  console.log("\n✅ Test execution completed.");
}

run();
