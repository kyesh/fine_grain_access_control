# QA Acceptance Test: 06 - Google Verification Compliance

## Overview
This acceptance test ensures that the application meets Google's requirements for API Services verification, specifically regarding the "Limited Use Policy Disclosure", scope transparency, and accessibility of required legal pages.

## Pre-requisites
* Application is running locally or deployed.
* The user is logged out (or logged in, since these pages must be public).

## Test 1: Legal Pages Accessibility from Homepage
**Objective:** Verify that the Privacy Policy and Terms of Service are discoverable and linked correctly from the homepage footer.

1. **Action:** Navigate to the homepage root `/`.
2. **Action:** Scroll to the bottom of the page (footer).
3. **Verify:** A link to "Privacy Policy" exists.
4. **Action:** Click "Privacy Policy".
5. **Verify:** The URL changes to `/privacy` and the Privacy Policy page renders.
6. **Action:** Navigate back to the homepage `/`.
7. **Verify:** A link to "Terms of Service" exists in the footer.
8. **Action:** Click "Terms of Service".
9. **Verify:** The URL changes to `/terms` and the Terms of Service page renders.

## Test 2: Limited Use Policy Disclosure
**Objective:** Verify that the Privacy Policy contains the exact "Limited Use Policy" phrasing required by Google for restricted scopes.

1. **Action:** Navigate to the Privacy Policy page (`/privacy`).
2. **Action:** Inspect the contents of the page.
3. **Verify:** The page explicitly states: *"SecureAgent's use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements."*
4. **Verify:** The page clarifies that the application does not permanently store email content, and only acts as a secure proxy to apply user-assigned security filters before returning data to the AI agents.

## Test 3: Transparent Scope Justification on Homepage
**Objective:** Verify that the homepage accurately and transparently describes *why* the Gmail scopes are being requested.

1. **Action:** Navigate to the homepage root `/`.
2. **Action:** Scroll to the "How We Use Google Data" section.
3. **Verify:** The page explicitly mentions the usage of Gmail APIs.
4. **Verify:** The page explains that scopes (such as `gmail.readonly`, `gmail.send`, `gmail.modify`) are requested to allow AI Agents (via the SecureAgent proxy) to read, send, or manage emails strictly based on the user's configured allowlists and blocklists. 
5. **Verify:** The page explicitly states that no Google user data or emails are read by humans or used for training AI models by the application provider itself.
