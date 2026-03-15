import { NextRequest, NextResponse } from "next/server";
import { currentUser, clerkClient } from "@clerk/nextjs/server";

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(
      user.id,
      "oauth_google"
    );
    const googleToken = tokenResponse.data?.[0]?.token;

    if (!googleToken) {
      return NextResponse.json(
        { error: "Could not fetch Google access token" },
        { status: 403 }
      );
    }

    const googleUrl = `https://www.googleapis.com/gmail/v1/users/me/labels`;
    const googleResponse = await fetch(googleUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${googleToken}`,
      },
    });

    if (!googleResponse.ok) {
        const errorText = await googleResponse.text();
        console.error("Failed to fetch labels from Google:", errorText);
        return NextResponse.json(
          { error: "Failed to fetch labels from Google API." },
          { status: googleResponse.status }
        );
    }

    const data = await googleResponse.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("API Error fetching labels:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
