# FGAC.ai
> Fine Grain Access Control for AI Agents

FGAC.ai acts as a secure, invisible proxy between your AI agents and Google Workspace APIs (like Gmail). It allows you to confidently give AI agents access to your accounts by defining strict Regular Expression-based content filters and target URL allowlists/blocklists.

## Features
- **Drop-in Compatibility**: AI Agents can use standard official Google SDKs (like `google-api-python-client` or Node.js `googleapis`) without requiring complex code changes. They just point their endpoint override to `https://fgac.ai/api/proxy`.
- **Content Filtering**: Use regex to silently block agents from reading sensitive emails (e.g., password resets, 2FA codes, or specific sender addresses).
- **Destructive Action Protection**: Globally configure rules to prevent your agent from ever clicking "Empty Trash" or permanently deleting threads.
- **Detailed Logging**: Review a dashboard of every request your agent makes, highlighting exactly what was allowed and what was blocked based on your rules.

## Licensing
This project is explicitly licensed for **Personal Use Only**. It may only be utilized by independent individuals managing their own personal Gmail or Google Workspace accounts. 

Any corporate use, use by employees on behalf of their company, or use within educational institutions is strictly prohibited without a separate Enterprise or Educational license. See `LICENSE` for exact liability limitations and restrictions.

## Local Setup

### 1. Prerequisites
- Node.js 18+
- PostgreSQL instance (e.g. Neon)
- A Google Cloud Project with the Gmail API enabled and OAuth credentials configured.
- A Clerk Account for authentication.

### 2. Environment Variables
Create a `.env.local` file at the root of the project with the following required variables:

```env
DATABASE_URL=your_postgres_url
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_pub_key
CLERK_SECRET_KEY=your_clerk_secret_key
GOOGLE_CLIENT_ID=your_gcp_client_id
GOOGLE_CLIENT_SECRET=your_gcp_client_secret
```

### 3. Database Setup
Ensure you run migrations before starting the project:
```bash
npm run db:push
```

### 4. Running the Dev Server
```bash
npm run dev
```

Navigate to [http://localhost:3000](http://localhost:3000) to view the application.
