# QA Acceptance Test: 08 - Missing Google Scopes

## Overview
This test verifies that the dashboard correctly identifies when a user logs in without checking all the requested Google OAuth scopes (specifically `gmail.modify`) or bypasses the flow entirely via a waitlist invite. It ensures that the system gracefully handles the missing permissions and directs the user to Clerk's native, compliant Account Settings UI to resolve it.

## Pre-requisites
* Application is running locally or deployed.
* The user account is newly created via an email/password invite or a Magic Link (bypassing Google).
* Or, the user logged in with Google but manually unchecked the `gmail.modify` permission during the consent flow.

## Test 1: Dashboard UI Warning Display
**Objective:** Verify that the dashboard appropriately flags the user's lack of Google OAuth scopes.

1. **Action:** Log in using the test account and navigate to `/dashboard`.
2. **Verify:** A prominent Amber/Yellow warning banner states: "⚠️ Action Required: You have not granted FGAC access to your Gmail or you are missing required permissions."
3. **Verify:** In the "Accessible Gmail Accounts" section, the user's primary email address is visually flagged (amber/yellow or disabled) instead of the standard active green state.

## Test 2: Native Compliant Connection Flow
**Objective:** Verify that the system relies on Clerk's programmatic OAuth UX to initiate Google connections directly.

1. **Action:** Inside the warning banner, click the "Sign in with Google" button.
2. **Verify:** The user is taken directly to Google's standard OAuth consent screen.
3. **Verify:** The consent screen specifically requests permission for modifying emails (`gmail.modify`).

## Test 3: Key Creation Safeguard
**Objective:** Verify that users cannot create API keys using their own email address while it lacks the prerequisite Google scopes.

1. **Action:** Navigate to the `/dashboard` without completing the Google connection (e.g. going back).
2. **Action:** Click the "Create New Key" button in the API Keys section.
3. **Verify:** In the Create API Key modal, the checkbox corresponding to the user's own email is strictly disabled and grayed out.
4. **Action:** Hover over the disabled checkbox.
5. **Verify:** A tooltip appears saying "Google Account not securely linked. Please connect it." or similar.
6. **Verify:** The word "proxy" is completely omitted from the UI text in this flow.

## Test 4: Resolution State
**Objective:** Ensure the dashboard returns to a healthy state automatically once scopes are correctly applied.

1. **Action:** Complete Test 2 by checking all requested permissions on Google's consent screen and returning to the application.
2. **Action:** Navigate or refresh `/dashboard`.
3. **Verify:** The warning banner is completely gone.
4. **Verify:** The user's primary email in "Accessible Gmail Accounts" is now active (green with a "You" badge).
5. **Action:** Click "Create New Key".
6. **Verify:** The checkbox for the user's own email is now active and selectable.
