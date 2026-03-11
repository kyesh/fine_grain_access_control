import { NextRequest, NextResponse } from 'next/server';

// export const runtime = 'edge'; // Optional: Use edge runtime for lower latency

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

async function handleProxyRequest(request: NextRequest, params: { path: string[] }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const proxyKey = authHeader.split(' ')[1];
    const fullPath = params.path.join('/');
    
    // Phase 2/3: Here we will use the Clerk SDK to validate `proxyKey`.
    // For Phase 1 (Building the structure before keys), we mock the identity.
    const mockUserId = "user-123";

    // 1. Evaluate Deletion Rules
    if (request.method === 'DELETE') {
      // Hardcoded safeguard from QA specs: Global block on generic empty trash
      if (fullPath.includes('messages/trash') || fullPath.includes('emptyTrash')) {
        return NextResponse.json({ 
          error: "Action Denied: Global safeguard prevents permanent deletion of all emails." 
        }, { status: 403 });
      }
      
      // In a real scenario we would fetch the metadata for the specific message ID being deleted
      // and check the sender against the `delete_whitelist` regex rules in the DB.
    }

    // 2. Evaluate Read / Inbound Rules
    if (request.method === 'GET' && fullPath.includes('messages/')) {
       // Mocking the rule check logic for "Block Account Security Emails" from QA Specs
       const isSecurityEmail = false; // In reality, we evaluate the fetched email content against Regex rules
       
       if (isSecurityEmail) {
         return NextResponse.json({ 
            error: "Access restricted: A message was received but blocked by the 'Block Account Security Emails' rule. You may notify the user they received a 2FA/Password Reset email, but you cannot view the content." 
         }, { status: 403 });
       }
    }

    // 3. Evaluate Send / Outbound Rules
    if (request.method === 'POST' && fullPath.includes('messages/send')) {
      const body = await request.clone().json().catch(() => ({}));
      // In reality we parse the raw RFC 2822 email string to extract the "To:" address
      const toAddress = body.raw ? "extracted_email@example.com" : null;
      
      const isWhitelisted = true; // In reality we check the DB `send_whitelist` rules
      
      if (!isWhitelisted) {
        return NextResponse.json({ 
          error: `Unauthorized email address. Please ask your user to add '${toAddress}' to the sending whitelist.` 
        }, { status: 403 });
      }
    }

    // Phase 3: If all rules pass, we fetch the REAL Google Access token from Clerk
    // const realGoogleTokenResponse = await clerkClient.users.getUserOauthAccessToken(mockUserId, 'oauth_google');
    // const realGoogleToken = realGoogleTokenResponse.data[0].token;
    
    // And proxy the fetch request to googleapis.com...
    
    // For Phase 1: Return success mockup
    return NextResponse.json({ 
       status: "success", 
       message: "Proxy request validated and (mock) forwarded successfully.",
       forwardedPath: `https://www.googleapis.com/${fullPath}`
    });

  } catch (error) {
    console.error('Proxy Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
