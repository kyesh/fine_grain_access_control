# QA Acceptance Test: 07 - Waitlist & Beta Sign Up Flow

## Overview
This acceptance test ensures that the new Waitlist / Beta Sign Up flow correctly captures user input across multiple steps, automatically saves partial submissions to prevent data loss upon abandonment, and successfully records the complete Van Westendorp pricing survey data.

## Pre-requisites
* Application is running locally or deployed.
* The database contains the `waitlist` schema with no prior entries for `test@example.com`.
* The user is logged out (the waitlist should be accessible to public users).

## Test 1: Navigation to Waitlist
**Objective:** Verify that the "Join Beta Waitlist" calls-to-action correctly route the user to the `/waitlist` page.

1. **Action:** Navigate to the homepage root `/`.
2. **Verify:** The primary CTA buttons (e.g., "Get Started" or "Sign In") have been replaced or augmented with a "Join Beta Waitlist" option.
3. **Action:** Click the "Join Beta Waitlist" button.
4. **Verify:** The URL changes to `/waitlist` and the first step of the form (Email Collection) is visible.

## Test 2: Partial Form Capture (Abandonment Recovery)
**Objective:** Verify that the system saves the user's progress iteratively as they move between steps, even if they never complete the final submission.

1. **Action:** On the `/waitlist` page (Step 1), enter the email `test@example.com`.
2. **Action:** Click the "Next" (or "Continue") button to proceed to Step 2.
3. **Verify:** The UI transitions to Step 2 (Number of Accounts).
4. **Action:** *Simulate Abandonment:* Close the browser tab or navigate completely away from the application (e.g., to `google.com`).
5. **Action:** (Backend Check) Query the `waitlist` table in the database.
6. **Verify:** A row exists where `email = 'test@example.com'` and `status = 'partial'`.

## Test 3: Updating Partial Submissions
**Objective:** Verify that if a user continues the form, the existing partial record is updated rather than creating a duplicate row.

1. **Action:** Navigate back to `/waitlist` (simulating a return visit, or continuing straight from Step 2).
2. **Action:** On Step 2, enter `5` for the number of Gmail accounts.
3. **Action:** Click "Next" to proceed to Step 3 (Pricing Survey).
4. **Verify:** The UI transitions to Step 3 (Van Westendorp Pricing).
5. **Action:** (Backend Check) Query the `waitlist` table in the database.
6. **Verify:** The row for `test@example.com` has `status = 'partial'` AND the `numAccounts` field is now `5`. No duplicate rows for `test@example.com` were created.

## Test 4: Complete Submission (Pricing Survey)
**Objective:** Verify that completing the Van Westendorp pricing survey and usage-based preferences marks the submission as complete.

1. **Action:** On Step 3 (Pricing Survey), enter the following values:
    * "Too Cheap" (doubt quality): `$5`
    * "Bargain": `$10`
    * "Getting Expensive": `$25`
    * "Too Expensive": `$50`
2. **Action:** Answer the pricing model preference question: "Would you prefer a flat seat-based subscription per connected Gmail, or a usage-based cost per API call?" (Select "Seat-based").
3. **Action:** Click "Next".
4. **Verify:** The UI transitions to Step 4 (Beta Group Opt-In).
5. **Action:** (Backend Check) Query the `waitlist` table in the database.
6. **Verify:** The row for `test@example.com` has `status = 'partial'` and the pricing preference fields are updated.

## Test 5: Beta Group Opt-In & Confirmation
**Objective:** Verify that users can choose between just joining the waitlist or expressly committing to the Beta Group requirements.

1. **Action:** On Step 4, observe the prompt asking if the user wants to join the active Beta group or just the waitlist.
2. **Action:** Select "Join Waitlist Only" and click "Submit".
3. **Verify:** The UI transitions to a success state. The database marks the row `status = 'completed'` and `wantsBeta = false`.
4. **Action:** (Alternative Flow) Instead of waitlist only, select "Join Beta Group".
5. **Verify:** Additional confirmation checkboxes appear:
    * "I agree to a 30-minute user feedback interview."
    * "I agree to the beta pricing of $5/month per connected Gmail account."
6. **Action:** Leave a checkbox empty and attempt to submit.
7. **Verify:** The form prevents submission and shows a validation error.
8. **Action:** Check both boxes and click "Submit".
9. **Verify:** The UI transitions to a success state. Database marks `status = 'completed'`, `wantsBeta = true`, `agreedToInterview = true`, and `agreedToBetaPricing = true`.

## Test 6: License and Hosting Restriction Documentation
**Objective:** Verify that the open-source community is explicitly informed that the project cannot be hosted or resold as a SaaS.

1. **Action:** Open the `LICENSE` file in the repository root.
2. **Verify:** The text explicitly prohibits "corporate, company, business entity, government agency, or educational institution" use.
3. **Verify:** The text explicitly prohibits offering the software as a hosted service or SaaS.
4. **Action:** Open the `README.md`.
5. **Verify:** The Licensing section clearly reiterates these limitations and directs enterprise/commercial interests to contact the author.
