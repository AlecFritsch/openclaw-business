import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';

  let agentId = '';
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    agentId = parsed.agentId || '';
  } catch {}

  const html = `<!DOCTYPE html>
<html><head><title>Connecting Google Drive…</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666">
<div style="text-align:center">
  <p>Connecting Google Drive…</p>
  <p style="font-size:13px;color:#999">This window will close automatically.</p>
</div>
<script>
  var code = ${JSON.stringify(code)};
  var sent = false;
  if (window.opener) {
    try {
      window.opener.postMessage({ type: 'oauth-callback', code: code, provider: 'google' }, '*');
      sent = true;
    } catch(e) {}
  }
  if (sent) {
    setTimeout(function() { window.close(); }, 500);
  } else {
    window.location.href = '/agents/${agentId}/memory?google_code=' + encodeURIComponent(code);
  }
</script>
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
