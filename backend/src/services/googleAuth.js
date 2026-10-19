import { OAuth2Client } from 'google-auth-library';
import config from '../config.js';
import { ApiError } from '../middleware/errors.js';

let client = null;

function getClient() {
  if (!client && config.googleClientId) {
    client = new OAuth2Client(config.googleClientId);
  }
  return client;
}

export function isGoogleConfigured() {
  return Boolean(config.googleClientId);
}

/**
 * Verify a Google ID token credential securely.
 * Validates cryptographic signature, issuer, audience, and expiration.
 * Supports deterministic simulation in test environments so CI/smoke suites
 * can test all edge cases without relying on live external Google servers.
 */
export async function verifyGoogleToken(input) {
  let credential = null;
  let accessToken = null;
  if (typeof input === 'string') {
    credential = input;
  } else if (input && typeof input === 'object') {
    credential = input.credential;
    accessToken = input.access_token;
  }

  if (!credential && !accessToken) {
    throw new ApiError(400, 'A Google credential token is required.');
  }

  // Handle access token verification (from GIS OAuth2 popup)
  if (accessToken) {
    if (typeof accessToken !== 'string') {
      throw new ApiError(400, 'Invalid Google access token format.');
    }
    if (accessToken.startsWith('test-google-token:')) {
      if (config.isProd) {
        throw new ApiError(403, 'Test tokens are not permitted in production.');
      }
      return verifyGoogleToken(accessToken);
    }
    if (!isGoogleConfigured()) {
      throw new ApiError(503, 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing).');
    }
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new ApiError(401, 'Google access token verification failed or token expired.');
      }
      const info = await res.json();
      if (!info.sub) {
        throw new ApiError(401, 'Invalid Google token payload: missing subject identifier.');
      }
      if (!info.email_verified) {
        throw new ApiError(403, 'Google account email must be verified.');
      }
      return {
        sub: info.sub,
        email: String(info.email || '').trim().toLowerCase(),
        name: info.name || info.email.split('@')[0],
        picture: info.picture || null,
        email_verified: Boolean(info.email_verified),
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, `Google access token verification failed: ${err.message}`);
    }
  }

  if (typeof credential !== 'string') {
    throw new ApiError(400, 'A Google credential token is required.');
  }

  // Controlled test harness tokens for deterministic verification without network
  if (credential.startsWith('test-google-token:')) {
    if (config.isProd) {
      throw new ApiError(403, 'Test tokens are not permitted in production.');
    }
    const [, sub, email, name, testScenario] = credential.split(':');
    if (testScenario === 'expired') {
      throw new ApiError(401, 'Google token has expired.');
    }
    if (testScenario === 'invalid_signature') {
      throw new ApiError(401, 'Invalid Google token signature.');
    }
    if (testScenario === 'audience_mismatch') {
      throw new ApiError(401, 'Google token audience mismatch.');
    }
    if (testScenario === 'unverified_email') {
      throw new ApiError(403, 'Google account email must be verified.');
    }
    return {
      sub: sub || 'test-google-sub-default',
      email: (email || 'google-user@fitforge.test').toLowerCase(),
      name: name || 'Google Athlete',
      picture: null,
      email_verified: true,
    };
  }

  if (!isGoogleConfigured()) {
    throw new ApiError(503, 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing).');
  }

  try {
    const c = getClient();
    const ticket = await c.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub) {
      throw new ApiError(401, 'Invalid Google token payload: missing subject identifier.');
    }

    const iss = payload.iss;
    if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
      throw new ApiError(401, `Invalid token issuer: ${iss}`);
    }

    if (!payload.email_verified) {
      throw new ApiError(403, 'Google account email must be verified.');
    }

    return {
      sub: payload.sub,
      email: String(payload.email || '').trim().toLowerCase(),
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null,
      email_verified: Boolean(payload.email_verified),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, `Google ID token verification failed: ${err.message}`);
  }
}
