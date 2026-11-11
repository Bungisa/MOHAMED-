export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(303, { Location: '/?action=pdf-reader' });
    res.end();
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const bodyBuf = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

    if (boundaryMatch && bodyBuf.length > 0) {
      const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
      const rawLatin1 = bodyBuf.toString('latin1');
      const parts = rawLatin1.split(boundary);

      for (const part of parts) {
        if (part.includes('name="SharedFiles"') || part.includes('filename="')) {
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
              : 'application/pdf';

            let contentLatin1 = part.slice(headerEndIdx + 4);
            if (contentLatin1.endsWith('\r\n')) {
              contentLatin1 = contentLatin1.slice(0, -2);
            }
            const fileBuffer = Buffer.from(contentLatin1, 'latin1');

            if (fileBuffer.length > 0) {
              const base64Data = fileBuffer.toString('base64');
              const safeFilename = JSON.stringify(rawFilename);
              const safeMime = JSON.stringify(partMime);

              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Opening in ElimikaPDF...</title>
</head>
<body style="background:#0D0A12;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;">
    <p style="font-size:15px;font-weight:600;">Opening PDF in ElimikaPDF Reader...</p>
  </div>
  <script>
    (async function() {
      try {
        var b64 = "${base64Data}";
        var filename = ${safeFilename};
        var mime = ${safeMime};
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if ('caches' in window) {
          var cache = await caches.open('elimikapdf-shared-files-v1');
          var headers = new Headers({
            'Content-Type': mime || 'application/pdf',
            'X-Shared-Filename': encodeURIComponent(filename || 'Shared_Document.pdf')
          });
          await cache.put(new Request('/__shared_file_latest'), new Response(bytes.buffer, { status: 200, headers: headers }));
        }
      } catch (e) {}
      window.location.replace('/?shared=1&action=pdf-reader');
    })();
  </script>
</body>
</html>`);
              return;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Vercel share-target error:', err);
  }

  res.writeHead(303, { Location: '/?action=pdf-reader' });
  res.end();
}
