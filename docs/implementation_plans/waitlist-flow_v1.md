# Waitlist Flow & CTA Updates

This plan covers adding the unverified app question to the waitlist questionnaire, and updating the CTA buttons on the landing page to heavily favor the waitlist over immediate sign ups to protect OAuth quota.

## User Review Required
> [!IMPORTANT]
> **Clarification needed on "Clerk waitlist process":**
> We currently have a custom multi-step waitlist at `/waitlist`. Your request states: "login buttons being replaced with the Clerk waitlist process but have it default to the waitlist UX with the option to switch to sign in."
> Do you want to:
> A) Use Clerk's native Waitlist component (`<Waitlist />`) instead of the custom `/waitlist` page? (This would mean losing the pricing/accounts survey).
> B) Keep the custom `/waitlist` page, but update the Landing Page buttons so the primary CTA goes to `/waitlist`, and change the `SignInButton` to use the `<SignUpButton mode="modal">` (which acts as Clerk's waitlist-enabled Sign Up modal and has a "sign in" link at the bottom)?
> I plan to proceed with **Option B** (keep custom questionnaire, update Landing Page CTAs to limit direct sign in) unless you specify otherwise.

## Proposed Changes

### Database Schema
- **`src/db/schema.ts`**:
  - Add `comfortableWithUnverifiedApp: text('comfortable_with_unverified_app')` to the `waitlist` table to store their response regarding unverified Google apps.

### Waitlist API
- **`src/app/api/waitlist/route.ts`**:
  - Update the POST handler payload to accept and save `comfortableWithUnverifiedApp`.

### Waitlist UI
- **`src/app/waitlist/page.tsx`**:
  - In Step 4 (Beta Access), add a new question when a user selects "Join the Active Beta Group":
    - Form question: "Google displays an 'Unverified App' warning during our beta phase. Are you comfortable proceeding with an unverified app?"
    - Input: Yes / No radio buttons.
  - Require this question to be answered before allowing them to submit the beta application.

### Acceptance Tests
- **`docs/QA_Acceptance_Test/07_waitlist_and_signup_flow.md`**:
  - Update Test 5 (Beta Group Opt-In & Confirmation) to include checking the unverified app warning question and verifying the database records `comfortable_with_unverified_app`.

### Landing Page CTAs
- **`src/app/page.tsx`**:
  - Modify the `<Show when="signed-out">` section.
  - Currently, we have "Join Beta Waitlist" (custom page) and "Sign In" (Clerk modal).
  - To minimize accidental Google OAuth hits, we will prioritize the Waitlist. I will update the "Sign In" button to use Clerk's `<SignUpButton mode="modal">` since if Waitlist is enabled in Clerk dashboard, it correctly presents the Waitlist UI and requires users to click a small link to sign in.

## Verification Plan

### Automated Tests
- Run `npm run db:push` (on a Neon isolated branch using `npm run db:branch`) to verify the schema updates safely.

### Manual Verification
- Navigate to `/` and click the login/signup buttons to verify it defaults to the waitlist UI with an option to sign in.
- Navigate to `/waitlist` and fill out the form, selecting "Join the Active Beta Group".
- Verify the new "Unverified App" question appears.
- Submit the form and verify in the database that `comfortable_with_unverified_app` is saved correctly.
