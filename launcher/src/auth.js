// Microsoft account sign-in for Minecraft, using a Microsoft login window (authorization code + PKCE)
// and the player's own
// Azure app ID. Mojang must approve that app ID before api.minecraftservices.com accepts it.
// Steps: Microsoft OAuth -> Xbox Live -> XSTS -> Minecraft token -> Minecraft profile.

const crypto = require('crypto');

const MS_TENANT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const USER_AGENT = 'quasar-client/launcher/1.0.0';

const XSTS_ERRORS = {
  2148916233: 'This Microsoft account has no Xbox profile yet. Sign in once at minecraft.net, then try again.',
  2148916235: 'Xbox Live is not available in your country or region.',
  2148916236: 'This account needs adult verification on xbox.com before it can sign in.',
  2148916237: 'This account needs adult verification on xbox.com before it can sign in.',
  2148916238: 'This is a child account. An adult must add it to a Microsoft family before it can play.',
};

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function post(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, ok: res.ok, data };
}

// ---------------------------------------------------------------- Microsoft

// Microsoft's recommended return address for apps that show the login page in their own window.
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Builds the Microsoft login page address, with PKCE so no secret is needed. */
function createLoginRequest(clientId) {
  if (!clientId) throw new AuthError('Add your Azure app ID in Settings first.', 'NO_CLIENT_ID');
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${MS_TENANT}/authorize?${params}`, verifier, state };
}

/**
 * Reads the address the login window was sent to. Returns the code when sign-in finished,
 * null while the player is still on Microsoft's pages, and throws when sign-in failed.
 */
function parseRedirect(url, expectedState) {
  if (!url.startsWith(REDIRECT_URI)) return null;
  const params = new URL(url).searchParams;
  const error = params.get('error');
  if (error) {
    if (error === 'access_denied') throw new AuthError('Sign-in was cancelled.', 'CANCELLED');
    throw new AuthError((params.get('error_description') || 'Microsoft sign-in failed.').split(/\r?\n/)[0], 'MS_ERROR');
  }
  if (params.get('state') !== expectedState) throw new AuthError('Sign-in could not be verified. Try again.', 'STATE');
  const code = params.get('code');
  if (!code) throw new AuthError('Microsoft did not return a sign-in code. Try again.', 'NO_CODE');
  return code;
}

async function redeemCode(clientId, code, verifier) {
  const r = await post(`${MS_TENANT}/token`, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    scope: SCOPE,
  }, true);
  if (!r.ok) {
    throw new AuthError((r.data.error_description || 'Microsoft sign-in failed.').split(/\r?\n/)[0], 'MS_ERROR');
  }
  return { msAccess: r.data.access_token, refreshToken: r.data.refresh_token };
}

async function refreshMicrosoft(clientId, refreshToken) {
  const r = await post(`${MS_TENANT}/token`, {
    grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE,
  }, true);
  if (!r.ok) throw new AuthError('Your sign-in expired. Sign in again in Settings.', 'REFRESH_FAILED');
  return { msAccess: r.data.access_token, refreshToken: r.data.refresh_token || refreshToken };
}

// ---------------------------------------------------------------- Xbox and Minecraft

async function minecraftFromMicrosoft(msAccess) {
  const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccess}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (!xbl.ok) throw new AuthError('Xbox Live sign-in failed.', 'XBL');
  const uhs = xbl.data.DisplayClaims?.xui?.[0]?.uhs;

  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (!xsts.ok) {
    throw new AuthError(XSTS_ERRORS[xsts.data.XErr] || 'Xbox Live refused the sign-in.', 'XSTS');
  }
  const xuid = xsts.data.DisplayClaims?.xui?.[0]?.xid || '0';

  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
  });
  if (mc.status === 403) {
    throw new AuthError(
      'Mojang has not approved your Azure app ID yet. Until it does, Play opens the Minecraft Launcher instead.',
      'APP_NOT_APPROVED');
  }
  if (!mc.ok) throw new AuthError('Minecraft sign-in failed. Try again in a minute.', 'MC');

  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.data.access_token}`, 'User-Agent': USER_AGENT },
  });
  if (profileRes.status === 404) {
    throw new AuthError('This Microsoft account does not own Minecraft: Java Edition.', 'NO_GAME');
  }
  if (!profileRes.ok) throw new AuthError('Could not read your Minecraft profile.', 'PROFILE');
  const profile = await profileRes.json();

  return {
    accessToken: mc.data.access_token,
    expiresAt: Date.now() + (mc.data.expires_in || 86400) * 1000,
    uuid: profile.id,
    name: profile.name,
    xuid,
  };
}

/**
 * Returns a usable Minecraft session, refreshing it when needed.
 * `account` is { refreshToken, session? }; the result includes the new refreshToken to store.
 */
async function getSession(clientId, account) {
  if (account.session && account.session.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { session: account.session, refreshToken: account.refreshToken };
  }
  const ms = await refreshMicrosoft(clientId, account.refreshToken);
  const session = await minecraftFromMicrosoft(ms.msAccess);
  return { session, refreshToken: ms.refreshToken };
}

module.exports = { AuthError, REDIRECT_URI, createLoginRequest, parseRedirect, redeemCode, minecraftFromMicrosoft, getSession };
