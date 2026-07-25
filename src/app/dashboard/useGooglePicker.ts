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

export function useGooglePicker(onSheetsPicked: (sheets: PickedSheet[]) => void) {
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

  const openPickerFlow = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      // 1. Fetch token and scope info from backend token bridge
      const tokenRes = await fetch('/api/auth/google-picker-token');
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        throw new Error(tokenData.error || 'Failed to fetch Google OAuth token.');
      }

      const existingGoogleAccount = user.externalAccounts.find(
        acc => acc.provider === 'google' || (acc.provider as any) === 'oauth_google'
      );

      // 2. If drive.file scope is missing, trigger Clerk reauthorization
      if (!tokenData.hasDriveFileScope) {
        const autoRedirectUrl = `${window.location.origin}/dashboard?autoOpenPicker=true`;
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
          onSheetsPicked(docs);
        }
        setIsLoading(false);
      };

      const view = new window.google.picker.View(window.google.picker.ViewId.SPREADSHEETS);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(tokenData.accessToken)
        .setCallback(pickerCallback)
        .setTitle('Select Google Sheets to Expose in FGAC')
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .build();

      picker.setVisible(true);
    } catch (err) {
      console.error('Error opening Google Picker:', err);
      setIsLoading(false);
    }
  }, [user, onSheetsPicked]);

  // Automatically launch Google Picker if returning from OAuth reauthorization redirect
  useEffect(() => {
    if (typeof window === 'undefined' || !user || !gapiLoaded) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autoOpenPicker') === 'true') {
      // Clean up URL parameter without page reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
      // Auto-launch picker
      openPickerFlow();
    }
  }, [user, gapiLoaded, openPickerFlow]);

  const enhancedOpenPicker = useReverification(openPickerFlow);

  const triggerAddSheets = async () => {
    try {
      await enhancedOpenPicker();
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
