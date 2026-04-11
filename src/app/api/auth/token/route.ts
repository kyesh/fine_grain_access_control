import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { proxyKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as jose from "jose";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let data: URLSearchParams;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      data = new URLSearchParams(text);
    } else {
      return NextResponse.json({ error: "invalid_request", error_description: "Unsupported content type" }, { status: 400 });
    }

    const grantType = data.get("grant_type");
    const assertion = data.get("assertion");

    if (grantType !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
    }

    if (!assertion) {
      return NextResponse.json({ error: "invalid_request", error_description: "Missing assertion" }, { status: 400 });
    }

    // Decode the token to discover the issuer
    let decoded;
    try {
      decoded = jose.decodeJwt(assertion);
    } catch (err) {
      return NextResponse.json({ error: "invalid_grant", error_description: "Invalid JWT structure" }, { status: 400 });
    }

    const issuer = decoded.iss;
    if (!issuer || !issuer.endsWith("@fgac.ai")) {
      return NextResponse.json({ error: "invalid_grant", error_description: "Invalid issuer" }, { status: 400 });
    }

    const proxyKeyString = issuer.split("@")[0];

    // Find the key and public key in database
    const keyData = await db.select().from(proxyKeys).where(eq(proxyKeys.key, proxyKeyString)).limit(1).then(res => res[0]);

    if (!keyData || !keyData.publicKey) {
      return NextResponse.json({ error: "invalid_grant", error_description: "Key not found or invalid" }, { status: 400 });
    }

    if (keyData.revokedAt) {
      return NextResponse.json({ error: "invalid_grant", error_description: "Key has been revoked" }, { status: 400 });
    }

    // Verify the signature
    try {
      const publicKey = await jose.importSPKI(keyData.publicKey, 'RS256');
      await jose.jwtVerify(assertion, publicKey);
    } catch (err) {
      return NextResponse.json({ error: "invalid_grant", error_description: "Signature verification failed" }, { status: 400 });
    }

    // Verification succeeded. Issue an access token.
    // We seamlessly issue their proxy key itself as the short-lived access token,
    // which our normal /api/proxy validation correctly handles!
    return NextResponse.json({
      access_token: proxyKeyString,
      token_type: "Bearer",
      expires_in: 3600
    });

  } catch (error) {
    console.error("Token exchange error:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
