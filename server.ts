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
  const PORT = 3000;

  // Store binary file for reliable HTTP GET download (fixes Android Chrome / WebView blob download errors in iframes)
  app.post(
    '/api/downloads',
    express.raw({ type: '*/*', limit: '100mb' }),
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

  // Serve Digital Asset Links for Google Play Store Trusted Web Activity (TWA) verification
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
  });

  // Fallback for cold-start Web Share Target POST requests if Service Worker hasn't claimed client yet
  app.post('/share-target', (_req, res) => {
    res.redirect(303, '/?action=pdf-reader');
  });

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
