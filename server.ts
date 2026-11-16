import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface StoredDownloadItem {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  createdAt: number;
}

const downloadStore = new Map<string, StoredDownloadItem>();

// Clean up expired download buffers older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of downloadStore.entries()) {
    if (now - item.createdAt > 30 * 60 * 1000) {
      downloadStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

function sanitizeFilename(raw: string, fallbackExt = 'pdf'): string {
  const trimmed = (raw || `Document.${fallbackExt}`).trim();
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext =
    lastDot > 0
      ? trimmed.slice(lastDot + 1).replace(/[^a-zA-Z0-9]/g, '') || fallbackExt
      : fallbackExt;

  const cleanBase = base
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);

  return `${cleanBase || 'Document'}.${ext.toLowerCase()}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Allow PWABuilder and external validators to inspect manifest, service worker, icons, and assetlinks
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Download-Filename, X-Download-Mimetype');
    next();
  });

  // Store binary file for reliable HTTP GET download (supports large PDFs up to 500 MB)
  app.post(
    '/api/downloads',
    express.raw({ type: '*/*', limit: '500mb' }),
    (req, res) => {
      try {
        const rawFilename =
          (req.query.filename as string) ||
          (req.headers['x-download-filename'] as string) ||
          'Document.pdf';
        const mimeType =
          (req.query.mimeType as string) ||
          (req.headers['x-download-mimetype'] as string) ||
          'application/pdf';

        const filename = sanitizeFilename(
          rawFilename,
          mimeType.includes('wordprocessingml') ||
            rawFilename.toLowerCase().endsWith('.docx')
            ? 'docx'
            : mimeType.includes('msword') ||
                rawFilename.toLowerCase().endsWith('.doc')
              ? 'doc'
              : mimeType.includes('jpeg') || mimeType.includes('jpg')
                ? 'jpg'
                : mimeType.includes('png')
                  ? 'png'
                  : mimeType.includes('text')
                    ? 'txt'
                    : 'pdf'
        );

        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body || []);

        if (bodyBuffer.length === 0) {
          res.status(400).json({ error: 'Empty file payload' });
          return;
        }

        const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        downloadStore.set(id, {
          buffer: bodyBuffer,
          filename,
          mimeType,
          createdAt: Date.now(),
        });

        const downloadUrl = `/api/downloads/${id}/${encodeURIComponent(filename)}`;
        res.json({ id, filename, downloadUrl, size: bodyBuffer.length });
      } catch (err) {
        console.error('Error storing download payload:', err);
        res.status(500).json({ error: 'Failed to prepare file download' });
      }
    }
  );

  // Serve stored binary file with full Android DownloadManager compatible headers
  const serveDownload = (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const item = downloadStore.get(id);
    if (!item) {
      res.status(404).send('Download link expired or not found. Please generate the file again.');
      return;
    }

    res.setHeader('Content-Type', item.mimeType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${item.filename}"; filename*=UTF-8''${encodeURIComponent(item.filename)}`
    );
    res.setHeader('Content-Length', String(item.buffer.length));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=1800');

    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }

    res.status(200).send(item.buffer);
  };

  app.head('/api/downloads/:id/:filename', serveDownload);
  app.get('/api/downloads/:id/:filename', serveDownload);
  app.head('/api/downloads/:id', serveDownload);
  app.get('/api/downloads/:id', serveDownload);

  // Android Native "Open With" (ACTION_VIEW content:// URI) Bridge Endpoint
  // Receives raw document/eBook/HTML/PDF bytes from Android PdfOpenActivity and issues a one-time openId
  app.post(
    '/api/android-open-pdf',
    express.raw({ type: '*/*', limit: '500mb' }),
    (req, res) => {
      try {
        const rawFilename =
          (req.query.filename as string) ||
          (req.headers['x-pdf-filename'] as string) ||
          'Opened_Document.pdf';
        const rawMime =
          (req.query.mime as string) ||
          (req.headers['x-pdf-mimetype'] as string) ||
          (req.headers['content-type'] as string) ||
          'application/octet-stream';

        const extMatch = rawFilename.toLowerCase().match(/\.([a-z0-9]+)$/);
        const fallbackExt = extMatch
          ? extMatch[1]
          : rawMime.includes('epub')
            ? 'epub'
            : rawMime.includes('kpf')
              ? 'kpf'
              : rawMime.includes('html')
                ? 'html'
                : 'pdf';
        const filename = sanitizeFilename(rawFilename, fallbackExt);
        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body || []);

        if (bodyBuffer.length < 1) {
          res.status(400).json({
            error: 'The selected file is empty or unreadable.',
          });
          return;
        }

        const openId = `android_doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        downloadStore.set(openId, {
          buffer: bodyBuffer,
          filename,
          mimeType: rawMime,
          createdAt: Date.now(),
        });

        const redirectUrl = `/?action=pdf-reader&android_open_id=${encodeURIComponent(openId)}&filename=${encodeURIComponent(filename)}`;
        res.status(200).json({
          openId,
          filename,
          mimeType: rawMime,
          size: bodyBuffer.length,
          redirectUrl,
        });
      } catch (err) {
        console.error('Error in /api/android-open-pdf:', err);
        res.status(500).json({ error: 'Failed to ingest Android document stream' });
      }
    }
  );

  app.get('/api/android-open-pdf/:id', (req, res) => {
    const id = req.params.id;
    const item = downloadStore.get(id);
    if (!item) {
      res.status(404).json({ error: 'Android document session expired or not found.' });
      return;
    }
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.setHeader('X-Android-Pdf-Filename', encodeURIComponent(item.filename));
    res.setHeader('X-Android-Pdf-Mimetype', item.mimeType || 'application/octet-stream');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Android-Pdf-Filename, X-Android-Pdf-Mimetype'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(item.buffer);
  });

  // Serve Digital Asset Links for Google Play Store Trusted Web Activity (TWA) verification
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
  });

  // =========================================================================
  // DROPBOX 3P OAUTH 2.0 ENDPOINTS (Popup Flow for Iframe Environment)
  // =========================================================================
  const getDropboxRedirectUri = (req: express.Request): string => {
    const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
    const base = (queryOrigin || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    return `${base}/auth/callback`;
  };

  app.get('/api/dropbox/auth-url', (req, res) => {
    const clientId = (process.env.DROPBOX_CLIENT_ID || process.env.CLIENT_ID || '').trim();
    const redirectUri = getDropboxRedirectUri(req);

    if (!clientId) {
      res.status(400).json({
        configured: false,
        redirectUri,
        error: 'Dropbox Client ID (DROPBOX_CLIENT_ID or CLIENT_ID) is not configured in environment variables.',
      });
      return;
    }

    const stateObj = Buffer.from(JSON.stringify({ redirectUri })).toString('base64url');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      token_access_type: 'online',
      state: stateObj,
    });

    const authUrl = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
    res.json({ configured: true, url: authUrl, redirectUri });
  });

  const handleDropboxCallback = async (req: express.Request, res: express.Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';

    if (errorParam || !code) {
      res.status(200).send(`<!DOCTYPE html>
<html>
  <head><title>Dropbox Authentication</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'dropbox', error: ${JSON.stringify(errorParam || 'Authorization cancelled')} }, '*');
        window.close();
      }
    </script>
    <p>Authentication cancelled. You may close this window.</p>
  </body>
</html>`);
      return;
    }

    try {
      const clientId = (process.env.DROPBOX_CLIENT_ID || process.env.CLIENT_ID || '').trim();
      const clientSecret = (process.env.DROPBOX_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
      let redirectUri = getDropboxRedirectUri(req);

      if (stateParam) {
        try {
          const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
          if (decoded && typeof decoded.redirectUri === 'string') {
            redirectUri = decoded.redirectUri;
          }
        } catch {
          // Ignore malformed state
        }
      }

      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error_description?: string;
        error?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        const msg = tokenData.error_description || tokenData.error || 'Failed to exchange Dropbox code for token';
        res.status(200).send(`<!DOCTYPE html>
<html>
  <head><title>Dropbox Authentication Error</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'dropbox', error: ${JSON.stringify(msg)} }, '*');
        window.close();
      }
    </script>
    <p>${msg}</p>
  </body>
</html>`);
        return;
      }

      res.status(200).send(`<!DOCTYPE html>
<html>
  <head><title>Dropbox Connected</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <script>
      if (window.opener) {
        window.opener.postMessage({
          type: 'OAUTH_AUTH_SUCCESS',
          provider: 'dropbox',
          accessToken: ${JSON.stringify(tokenData.access_token)}
        }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
    <p>Dropbox authentication successful. This window will close automatically.</p>
  </body>
</html>`);
    } catch (err) {
      console.error('Dropbox callback error:', err);
      res.status(500).send('Dropbox authentication failed.');
    }
  };

  app.get(['/auth/callback', '/auth/callback/', '/auth/dropbox/callback', '/auth/dropbox/callback/'], handleDropboxCallback);

  // Serve Google Play Console compliant Privacy Policy page at /privacy-policy, /privacy, and /privacy-policy.html
  const servePrivacyPolicy = (_req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
  };
  app.get('/privacy-policy', servePrivacyPolicy);
  app.get('/privacy', servePrivacyPolicy);
  app.get('/privacy-policy.html', servePrivacyPolicy);

  // Cold-start Web Share Target POST handler (extracts multipart file if Service Worker hasn't claimed client yet)
  app.post(
    '/share-target',
    express.raw({ type: '*/*', limit: '500mb' }),
    (req, res) => {
      try {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

        if (boundaryMatch && bodyBuf.length > 0) {
          const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
          const rawLatin1 = bodyBuf.toString('latin1');
          const parts = rawLatin1.split(boundary);

          for (const part of parts) {
            if (
              part.includes('name="SharedFiles"') ||
              part.includes('filename="')
            ) {
              const headerEndIdx = part.indexOf('\r\n\r\n');
              if (headerEndIdx !== -1) {
                const headerSection = part.slice(0, headerEndIdx);
                const fnMatch = headerSection.match(/filename="([^"]+)"/i);
                const ctMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
                const rawFilename = fnMatch
                  ? Buffer.from(fnMatch[1], 'latin1').toString('utf8')
                  : 'Shared_Document.pdf';
                const partMime = ctMatch
                  ? ctMatch[1].trim()
                  : 'application/octet-stream';

                // Extract binary body (trimming trailing \r\n before next boundary)
                let contentLatin1 = part.slice(headerEndIdx + 4);
                if (contentLatin1.endsWith('\r\n')) {
                  contentLatin1 = contentLatin1.slice(0, -2);
                }
                const fileBuffer = Buffer.from(contentLatin1, 'latin1');

                if (fileBuffer.length > 0) {
                  const id = `shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  downloadStore.set(id, {
                    buffer: fileBuffer,
                    filename: rawFilename,
                    mimeType: partMime,
                    createdAt: Date.now(),
                  });
                  res.redirect(
                    303,
                    `/?shared_server_id=${encodeURIComponent(id)}&filename=${encodeURIComponent(rawFilename)}&mime=${encodeURIComponent(partMime)}`
                  );
                  return;
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Error parsing /share-target POST:', err);
      }
      res.redirect(303, '/?action=pdf-reader');
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });

    // Prevent /@vite/client from opening a failing HMR WebSocket on port 24678 in Cloud Run / AI Studio preview
    app.get('/@vite/client', async (req, res, next) => {
      try {
        const result = await vite.transformRequest(req.originalUrl || '/@vite/client');
        if (result && result.code) {
          const patchedCode = result.code.replace(
            /createWebSocketModuleRunnerTransport\s*\(/g,
            '(() => ({ async connect() {}, async disconnect() {}, send() {}, async invoke() { return {}; } }))('
          );
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.status(200).send(patchedCode);
          return;
        }
      } catch {
        // Fall through to default Vite middleware if transformRequest fails
      }
      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ElimikaPDF server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
