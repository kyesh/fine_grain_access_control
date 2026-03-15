# Implementation Plan: Waitlist Feature and License Update

## Goal Description
The objective is to implement a public Waitlist / Beta Access sign-up flow that captures partial submissions and runs an industry-standard pricing survey (Van Westendorp Price Sensitivity Meter). We must also update the custom `LICENSE` to explicitly prohibit third parties from offering FGAC.ai as a managed/hosted SaaS, protecting our own planned managed service.

*Note on Google Verification:* The open-source `LICENSE` changes do **not** impact the success of passing the Google Verification process for restricted OAuth scopes, as Google's verification focuses solely on user-facing Privacy Policies, Terms of Service, and actual API usage.

## Proposed Changes

### 1. Database Schema
---
#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add a new `waitlist` table to capture partial and completed form submissions.
- Columns:
  - `id` (UUID, primary key)
  - `email` (Text, optional for partial captures if they skip to other fields, but generally the first step)
  - `numAccounts` (Text/Int)
  - `priceTooCheap` (Numeric/Text)
  - `priceBargain` (Numeric/Text)
  - `priceExpensive` (Numeric/Text)
  - `priceTooExpensive` (Numeric/Text)
  - `pricingModelPreference` (Text: 'seat-based vs usage-based')
  - `wantsBeta` (Boolean)
  - `agreedToInterview` (Boolean)
  - `agreedToBetaPricing` (Boolean)
  - `status` (Text: 'partial', 'completed')
  - `createdAt`
  - `updatedAt`

### 2. API Routes
---
#### [NEW] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/waitlist/route.ts)
- Create a `POST` endpoint that accepts partial form data.
- If no `id` is provided in the request body, it creates a new row with `status='partial'` and returns the generated `id`.
- If an `id` is provided, it updates the existing row with the new field values, effectively auto-saving the user's progress.
- Once the final step is submitted, it marks `status='completed'`.

### 3. User Interface
---
#### [NEW] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/waitlist/page.tsx)
- Create a multi-step Waitlist signup page:
  - **Step 1:** Email Address
  - **Step 2:** Number of Gmail accounts they plan to manage
  - **Step 3 (Pricing Strategy):** 
    - The Van Westendorp Pricing Survey (4 questions: too cheap, bargain, expensive, too expensive).
    - A multiple-choice question on pricing model preference: "Cost per API call (usage-based) vs Seat subscription per Gmail account".
  - **Step 4 (Beta Group vs Waitlist):**
    - Ask if they want to join the active Beta Group or just the waitlist.
    - If "Waitlist", they can submit immediately.
    - If "Beta", they MUST explicitly check two confirmation boxes before submitting:
      1. "I commit to a 30-minute user interview."
      2. "I agree to the beta pricing of $5 per connected Gmail account per month."
- The React component will call `POST /api/waitlist` silently as the user moves between steps (on "Next" click) so partial data is retained even if they abandon the page.

#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Update the homepage calls-to-action to say "Join Beta Waitlist" and link them to `/waitlist` instead of immediate signup.

### 4. License Update
---
#### [MODIFY] [LICENSE](file:///home/kyesh/GitRepos/fine_grain_access_control/LICENSE)
- Add an explicit "NO HOSTING OR SAAS" clause.
- Clarify that the license grants individuals the right to *run the code* themselves for their own accounts, but absolutely prohibits anyone from offering this software as a managed service, hosted solution, or SaaS to third parties.

## Verification Plan

### Database Safety
- **CRITICAL**: All database schema changes must be run on an isolated branch first using `npm run db:branch`.

### Automated Tests
- Run `npm run lint` and `npm run build` to verify standard checks.

### Manual Verification
- Spin up the local dev server.
- Open the `/waitlist` page using the browser agent.
- Navigate through Step 1 (Email) and Step 2 (Accounts), then suddenly navigate away to simulate abandonment.
- Query the local database or verify server logs to ensure the partial submission was captured successfully.
- Complete a full submission to ensure the final state updates to `completed`.
