"use client";

import { useState, useCallback, useEffect } from 'react';
import { useUser, useReverification } from '@clerk/nextjs';
import { isReverificationCancelledError } from '@clerk/nextjs/errors';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export interface PickedSheet {
  id: string;
  name: string;
}

/**
 * Google Picker flow for exposing sheets.
 *
 * `context` is an opaque string (e.g. a profile id) carried through the whole
 * flow — including the OAuth consent redirect — and handed back to
 * `onSheetsPicked`, so callers know which profile the exposure was for.
 *
 * First-time-grant round trip: the consent redirect returns to the SAME page
 * (`location.pathname`), and the auto-open effect re-launches the picker there.
 * On that return leg we retry the token fetch while Clerk propagates the new
 * scope, and never redirect to consent a second time (no loops).
 */
export function useGooglePicker(onSheetsPicked: (sheets: PickedSheet[], context?: string) => void) {
  const { user } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [gapiLoaded, setGapiLoaded] = useState(false);

  // Dynamically load Google API script (api.js)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.gapi) {
      setGapiLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      window.gapi.load('picker', () => {
        setGapiLoaded(true);
      });
    };
    document.body.appendChild(script);
  }, []);

  const openPickerFlow = useCallback(async (context?: string, fromOAuthReturn = false) => {
    if (!user) return;
    setIsLoading(true);

    try {
      // 1. Fetch token and scope info from the backend token bridge. When we
      // just returned from consent, Clerk may not have propagated the new
      // scope yet — poll briefly instead of concluding it's missing.
      const fetchToken = async () => {
        const res = await fetch('/api/auth/google-picker-token');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Google OAuth token.');
        return data;
      };

      let tokenData = await fetchToken();
      if (fromOAuthReturn && !tokenData.hasDriveFileScope) {
        for (let attempt = 0; attempt < 4 && !tokenData.hasDriveFileScope; attempt++) {
          await new Promise(r => setTimeout(r, 1500));
          tokenData = await fetchToken();
        }
      }

      const existingGoogleAccount = user.externalAccounts.find(
        acc => acc.provider === 'google' || (acc.provider as any) === 'oauth_google'
      );

      // 2. If drive.file scope is missing, trigger Clerk reauthorization.
      // Never from the OAuth return leg — that would loop.
      if (!tokenData.hasDriveFileScope) {
        if (fromOAuthReturn) {
          alert('Google did not grant Sheets access. Please try "Add Google Sheet" again.');
          setIsLoading(false);
          return;
        }

        // Return to the page the user is on, and re-open the picker there.
        // Existing query params ride along — the approve page's signed token
        // must survive the consent round-trip or the flow dead-ends.
        const params = new URLSearchParams(window.location.search);
        params.set('autoOpenPicker', 'true');
        if (context) params.set('pickerContext', context);
        const autoRedirectUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        let verificationUrl: string | undefined;

        if (existingGoogleAccount && existingGoogleAccount.verification?.status === 'verified') {
          const response = await existingGoogleAccount.reauthorize({
            additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
            redirectUrl: autoRedirectUrl,
            oidcPrompt: 'consent'
          });
          verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
        } else {
          if (existingGoogleAccount) {
            await existingGoogleAccount.destroy();
          }
          const response = await user.createExternalAccount({
            strategy: 'oauth_google',
            redirectUrl: autoRedirectUrl,
          });
          verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
        }

        if (verificationUrl) {
          window.location.href = verificationUrl;
          return;
        }
      }

      // 3. Launch Google Picker
      if (!window.gapi || !window.google) {
        alert('Google Picker library loading... Please try again in a moment.');
        setIsLoading(false);
        return;
      }

      const pickerCallback = (data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const docs = data.docs.map((doc: any) => ({
            id: doc.id,
            name: doc.name || `Spreadsheet (${doc.id.slice(0, 6)})`
          }));
          onSheetsPicked(docs, context);
        }
        setIsLoading(false);
      };

      const view = new window.google.picker.View(window.google.picker.ViewId.SPREADSHEETS);
      const builder = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(tokenData.accessToken)
        .setCallback(pickerCallback)
        .setTitle('Select Google Sheets to Expose in FGAC')
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);

      // Without the Cloud project number, a drive.file pick is cosmetic:
      // Google never registers the per-file grant and every later API call on
      // the picked sheet 404s. The token bridge derives it from the token.
      if (tokenData.appId) {
        builder.setAppId(tokenData.appId);
      } else {
        console.warn('Picker running without appId — drive.file grants may not register.');
      }

      const picker = builder.build();

      picker.setVisible(true);
    } catch (err) {
      console.error('Error opening Google Picker:', err);
      setIsLoading(false);
    }
  }, [user, onSheetsPicked]);

  // Automatically launch Google Picker if returning from OAuth reauthorization
  // redirect. The component consuming this hook must live on the page the
  // redirect returns to (openPickerFlow redirects to location.pathname, so it
  // does as long as the triggering component initiated the flow).
  useEffect(() => {
    if (typeof window === 'undefined' || !user || !gapiLoaded) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autoOpenPicker') === 'true') {
      const context = urlParams.get('pickerContext') ?? undefined;
      // Consume only our params; anything else (e.g. the approve page's
      // token) must survive the cleanup.
      urlParams.delete('autoOpenPicker');
      urlParams.delete('pickerContext');
      const rest = urlParams.toString();
      const newUrl = `${window.location.pathname}${rest ? `?${rest}` : ''}`;
      window.history.replaceState({}, document.title, newUrl);
      // Auto-launch picker; fromOAuthReturn tolerates scope-propagation lag
      openPickerFlow(context, true);
    }
  }, [user, gapiLoaded, openPickerFlow]);

  const enhancedOpenPicker = useReverification(openPickerFlow);

  const triggerAddSheets = async (context?: string) => {
    try {
      await enhancedOpenPicker(context);
    } catch (err) {
      if (!isReverificationCancelledError(err)) {
        console.error('Picker error:', err);
      }
      setIsLoading(false);
    }
  };

  return {
    triggerAddSheets,
    isLoading,
    gapiLoaded
  };
}
