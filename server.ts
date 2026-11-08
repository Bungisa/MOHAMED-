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
          mimeType.includes('jpeg') || mimeType.includes('jpg')
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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
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
    console.log(`ScanPro Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
