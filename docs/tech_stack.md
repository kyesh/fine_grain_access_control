# Technical Architecture Strategy

This document outlines the core technical stack for the Fine-Grained Access Control Proxy platform.

## Infrastructure
**Vercel & Neon Postgres**
We will build this platform as a high-performance, edge-deployable application.
*   **Vercel**: Provides serverless edge functions for our API routes. Because our proxy sits in the critical path of every API call an agent makes, latency is paramount. Edge functions allow us to process validation rules instantly, close to the agent's deployment region.
*   **Neon Postgres**: A scalable, serverless Postgres database. It pairs perfectly with Vercel's edge architecture natively via HTTP connection pooling, preventing connection exhaustion when handling spikes of agent traffic.

## Authentication & Credential Management
**WorkOS**
We will utilize WorkOS as our central B2B Identity and OAuth Token Vault. 

### Why WorkOS over Alternatives (like Clerk)?
While platforms like Clerk excel at B2C user authentication and UI components, our core architectural challenge revolves around the **secure ingestion, storage, and lifecycle management (refreshing) of third-party Google OAuth credentials.**

*   **First-Class B2B Token Management**: WorkOS is designed fundamentally as an enterprise token and directory management platform. When a user connects their Google account to our proxy, WorkOS securely handles the OAuth handshake.
*   **Refresh Token Lifecycle (Pipes)**: The most dangerous and failure-prone aspect of building an API proxy is managing the Google Refresh Token lifecycle. If a refresh token expires, the background agent crashes. WorkOS natively handles the automatic refreshing of tokens. Our edge API simply requests a valid token from WorkOS, and WorkOS guarantees it is fresh.
*   **SOC2 & Enterprise Readiness**: Because Prong 3 of our strategy targets Enterprise CISOs (HTTPS MITM Proxy), we must ensure that the centralized vault holding corporate Google credentials is unassailable. WorkOS provides the SOC2 compliance and enterprise trust required for B2B sales natively out-of-the-box.

## Data Flow (The Token Vault Pattern)
1. **User Setup**: User authenticates with our application via WorkOS AuthKit. They grant our application access to their Google Account (`https://www.googleapis.com/auth/drive`). WorkOS stores the Google Refresh Token.
2. **Credential Issuance**: We issue the user a "Fake" Google Service Account JSON file (or a Custom API Key) linked to their internal `user_id`.
3. **Agent Request**: The user's AI Agent makes a request to `https://proxy.ourdomain.com`, using our fake credential.
4. **Proxy Intercept**: Our Vercel Edge function receives the request. It validates the fake credential, mapping it back to the `user_id`.
5. **Rule Evaluation**: We query Neon Postgres for the fine-grained rules associated with this `user_id` (e.g., "Is DELETE allowed on this folder ID?").
6. **Token Retrieval**: If the request is valid, our Vercel Edge function asks WorkOS for the user's *real*, fresh Google Access Token.
7. **Forwarding**: We append the real Google Access token to the request and forward it to `https://www.googleapis.com`.
