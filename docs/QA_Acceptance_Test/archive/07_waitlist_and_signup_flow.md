# QA Acceptance Test: 07 - Waitlist Removal & Redirect

## Overview
This acceptance test ensures that the legacy waitlist flow has been completely removed and that any attempts to access the `/waitlist` route are successfully redirected to the application dashboard.

## Pre-requisites
* Application is running locally or deployed.

## Test 1: Waitlist Route Redirection
**Objective:** Verify that the `/waitlist` route no longer hosts the waitlist form and correctly redirects users.

1. **Action:** Navigate directly to the `/waitlist` URL.
2. **Verify:** The application immediately redirects the browser to the `/dashboard` route (or the authentication flow if not signed in).
3. **Verify:** The legacy waitlist form is not rendered at any point during the redirect.

## Test 2: Landing Page CTAs
**Objective:** Verify that the waitlist CTAs have been removed from the landing page.

1. **Action:** Navigate to the homepage root `/`.
2. **Verify:** The "Join Beta Waitlist" buttons are no longer present.
3. **Verify:** The CTAs have been replaced with "Get Started" (for logged-out users) and "Go to Dashboard" (for logged-in users).
