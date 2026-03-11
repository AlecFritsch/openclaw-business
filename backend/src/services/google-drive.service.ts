// Google Drive Service — OAuth + file sync for Knowledge

import { config } from '../config/env.js';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const data = await res.json() as any;
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Failed to refresh Google token');
  const data = await res.json() as any;
  return data.access_token;
}

export async function listDriveFiles(accessToken: string, folderId?: string): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>> {
  let query = "mimeType != 'application/vnd.google-apps.folder' and trashed = false";
  if (folderId) query += ` and '${folderId}' in parents`;
  const params = new URLSearchParams({ q: query, fields: 'files(id,name,mimeType,modifiedTime)', pageSize: '100' });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = await res.json() as any;
  return data.files || [];
}

export async function downloadDriveFile(accessToken: string, fileId: string, mimeType: string): Promise<{ buffer: Buffer; exportedMime: string }> {
  const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.');
  let url: string;
  let exportedMime = mimeType;
  if (isGoogleDoc) {
    exportedMime = mimeType.includes('document') ? 'text/plain' : mimeType.includes('spreadsheet') ? 'text/csv' : 'text/plain';
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportedMime)}`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), exportedMime };
}
