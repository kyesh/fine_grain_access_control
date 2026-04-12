/**
 * Gmail API client using the official Google SDK with rootUrl override.
 *
 * IMPORTANT: This module uses the real googleapis SDK with rootUrl,
 * which is the SAME code path our users follow. Previous versions used
 * raw fetch() which bypassed the SDK entirely and masked broken configuration.
 *
 * How rootUrl works in the Node.js googleapis SDK:
 *   - rootUrl replaces only the domain/origin
 *   - The SDK appends /gmail/v1/ and the method path automatically
 *   - Any path included in rootUrl is STRIPPED by the SDK internals
 *   - Example: rootUrl: 'https://gmail.fgac.ai/' → requests go to
 *     https://gmail.fgac.ai/gmail/v1/users/{userId}/messages
 */
import { google } from 'googleapis';
import { PROXY_API_KEY, ROOT_URL } from './config.js';

function getGmailClient() {
  if (!PROXY_API_KEY) {
    console.warn("WARNING: PROXY_API_KEY environment variable is missing.");
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: PROXY_API_KEY });

  return google.gmail({
    version: 'v1',
    auth,
    rootUrl: ROOT_URL + '/',
  });
}

const gmail = getGmailClient();

export async function listMessages(email, maxResults = 10, q = '') {
  try {
    const res = await gmail.users.messages.list({
      userId: email,
      maxResults,
      q: q || undefined,
    });
    return { status: 200, data: res.data };
  } catch (error) {
    return {
      status: error.response?.status || error.code || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}

export async function getMessage(email, messageId) {
  try {
    const res = await gmail.users.messages.get({
      userId: email,
      id: messageId,
    });
    return { status: 200, data: res.data };
  } catch (error) {
    return {
      status: error.response?.status || error.code || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}

export async function sendEmail(email, to, subject, bodyText) {
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\n\r\n${bodyText}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    const res = await gmail.users.messages.send({
      userId: email,
      requestBody: { raw },
    });
    return { status: 200, data: res.data };
  } catch (error) {
    return {
      status: error.response?.status || error.code || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}

export async function trashMessage(email, messageId) {
  try {
    const res = await gmail.users.messages.trash({
      userId: email,
      id: messageId,
    });
    return { status: 200, data: res.data };
  } catch (error) {
    return {
      status: error.response?.status || error.code || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}

export async function listLabels(email) {
  try {
    const res = await gmail.users.labels.list({ userId: email });
    return { status: 200, data: res.data };
  } catch (error) {
    return {
      status: error.response?.status || error.code || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}
