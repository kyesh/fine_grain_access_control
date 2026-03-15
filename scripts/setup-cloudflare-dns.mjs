import https from 'node:https';

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DOMAIN_NAME = 'fgac.ai';
const VERCEL_IP = '76.76.21.21'; // Standard Vercel IPv4 address

if (!CLOUDFLARE_API_TOKEN) {
  console.error('Error: Please set the CLOUDFLARE_API_TOKEN environment variable.');
  console.log('Usage: CLOUDFLARE_API_TOKEN="your_token_here" node scripts/setup-cloudflare-dns.mjs');
  process.exit(1);
}

// Helper function to make HTTP requests
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve(parsedData);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function run() {
  try {
    console.log(`\n🔍 Looking up Zone ID for ${DOMAIN_NAME}...\n`);
    
    // 1. Get the Zone ID for fgac.ai
    const zonesResponse = await makeRequest({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/zones?name=${DOMAIN_NAME}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!zonesResponse.success) {
      throw new Error(`Failed to fetch zones: ${JSON.stringify(zonesResponse.errors)}`);
    }

    if (zonesResponse.result.length === 0) {
      throw new Error(`Domain ${DOMAIN_NAME} not found in your Cloudflare account.`);
    }

    const zoneId = zonesResponse.result[0].id;
    console.log(`✅ Found Zone ID for ${DOMAIN_NAME}: ${zoneId}`);
    
    // 2. Check if the DNS record already exists to avoid duplicates
    console.log(`\n🔍 Checking for existing A records for ${DOMAIN_NAME}...\n`);
    
    const recordsResponse = await makeRequest({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/zones/${zoneId}/dns_records?type=A&name=${DOMAIN_NAME}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!recordsResponse.success) {
      throw new Error(`Failed to fetch DNS records: ${JSON.stringify(recordsResponse.errors)}`);
    }

    const existingRecord = recordsResponse.result.find(r => r.content === VERCEL_IP);

    if (existingRecord) {
      console.log(`✅ Vercel A record (${VERCEL_IP}) already exists for ${DOMAIN_NAME}. No action needed.`);
      return;
    }

    // 3. Create the new DNS record pointing to Vercel
    console.log(`\n⚙️ Creating A record pointing ${DOMAIN_NAME} to ${VERCEL_IP}...\n`);
    
    const createResponse = await makeRequest({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/zones/${zoneId}/dns_records`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }, {
      type: 'A',
      name: DOMAIN_NAME,
      content: VERCEL_IP,
      ttl: 1,           // "Automatic" TTL
      proxied: false    // "DNS only" (Orange cloud OFF, recommended for Vercel)
    });

    if (!createResponse.success) {
      throw new Error(`Failed to create DNS record: ${JSON.stringify(createResponse.errors)}`);
    }

    console.log(`🎉 Success! Safely routed ${DOMAIN_NAME} to Vercel (Current IP: ${VERCEL_IP}).`);
    console.log(`Note: It may take a few minutes for Vercel to verify the new DNS configuration.`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

run();
