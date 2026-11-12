import { env } from '../../config/env.js';

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

export type DriveFileContent = {
  name: string;
  mimeType: 'application/pdf' | typeof DOCX_MIME_TYPE;
  extension: 'pdf' | 'docx';
  content: Buffer;
};

function credentials() {
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET.',
    );
  }
  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
    redirectUri: `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/integrations/google-drive/callback`,
  };
}

export function googleDriveAuthorizationUrl(state: string): string {
  const config = credentials();
  const url = new URL(OAUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return url.toString();
}

async function googleError(response: Response, fallback: string): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'error_description' in payload) {
    const message = payload.error_description;
    if (typeof message === 'string') return new Error(message.slice(0, 300));
  }
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = payload.error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = error.message;
      if (typeof message === 'string') return new Error(message.slice(0, 300));
    }
  }
  return new Error(fallback);
}

async function exchangeCode(code: string): Promise<string> {
  const config = credentials();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok)
    throw await googleError(response, 'Google authorization could not be completed.');
  const tokens: unknown = await response.json();
  if (typeof tokens !== 'object' || tokens === null || !('refresh_token' in tokens)) {
    throw new Error(
      'Google did not return offline access. Reconnect and approve the requested access.',
    );
  }
  const refreshToken = tokens.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length < 1) {
    throw new Error('Google did not return a valid refresh token.');
  }
  return refreshToken;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const config = credentials();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok)
    throw await googleError(
      response,
      'Google Drive authorization expired. Reconnect this account.',
    );
  const tokens: unknown = await response.json();
  if (typeof tokens !== 'object' || tokens === null || !('access_token' in tokens)) {
    throw new Error('Google did not return an access token.');
  }
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string' || accessToken.length < 1) {
    throw new Error('Google returned an invalid access token.');
  }
  return accessToken;
}

function safeFilename(name: string, extension: string): string {
  const cleaned = name.replace(/[\\/\0]/g, '_').slice(0, 240);
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

export async function fetchGoogleDriveFile(
  refreshToken: string,
  fileId: string,
  maxBytes: number,
): Promise<DriveFileContent> {
  const accessToken = await refreshAccessToken(refreshToken);
  const metadataResponse = await fetch(
    `${DRIVE_API_URL}/${encodeURIComponent(fileId)}?${new URLSearchParams({ fields: 'id,name,mimeType,size' })}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!metadataResponse.ok) {
    throw await googleError(
      metadataResponse,
      'Could not access that Google Drive file. Check sharing and permissions.',
    );
  }
  const metadata: unknown = await metadataResponse.json();
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('name' in metadata) ||
    !('mimeType' in metadata) ||
    typeof metadata.name !== 'string' ||
    typeof metadata.mimeType !== 'string'
  ) {
    throw new Error('Google Drive returned invalid file metadata.');
  }

  const isGoogleDoc = metadata.mimeType === GOOGLE_DOC_MIME_TYPE;
  const isPdf = metadata.mimeType === 'application/pdf';
  const isDocx = metadata.mimeType === DOCX_MIME_TYPE;
  if (!isGoogleDoc && !isPdf && !isDocx) {
    throw new Error(
      'Choose a PDF, DOCX, or Google Docs file. Other Drive file types are not supported.',
    );
  }
  if ('size' in metadata && typeof metadata.size === 'string' && Number(metadata.size) > maxBytes) {
    throw new Error(
      `The selected file exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB upload limit.`,
    );
  }

  const extension = isPdf ? 'pdf' : 'docx';
  const mimeType = isPdf ? 'application/pdf' : DOCX_MIME_TYPE;
  const url = isGoogleDoc
    ? `${DRIVE_API_URL}/${encodeURIComponent(fileId)}/export?${new URLSearchParams({ mimeType: DOCX_MIME_TYPE })}`
    : `${DRIVE_API_URL}/${encodeURIComponent(fileId)}?alt=media`;
  const contentResponse = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!contentResponse.ok) {
    throw await googleError(contentResponse, 'Google Drive could not download the selected file.');
  }
  const content = Buffer.from(await contentResponse.arrayBuffer());
  if (content.byteLength === 0) throw new Error('The selected Google Drive file is empty.');
  if (content.byteLength > maxBytes) {
    throw new Error(
      `The selected file exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB upload limit.`,
    );
  }
  return { name: safeFilename(metadata.name, extension), mimeType, extension, content };
}

export async function exchangeGoogleDriveAuthorization(code: string): Promise<string> {
  return exchangeCode(code);
}
