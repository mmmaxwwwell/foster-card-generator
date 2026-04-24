// Fixture proxy for the Foster Card Generator E2E harness.
//
// Listens on a local port, accepts both direct HTTP and HTTPS CONNECT tunnels,
// terminates TLS locally with a self-signed cert, and dispatches by Host header
// to the frozen fixture files under test/e2e/fixtures/.
//
// Any request whose host+path doesn't match a known fixture returns 404 so
// tests fail loud on unexpected network traffic.

const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const url = require('url');
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function log(verbose, ...args) {
  if (verbose) console.error('[proxy]', ...args);
}

function readFixture(relPath) {
  return fs.readFileSync(path.join(FIXTURES_DIR, relPath));
}

// Dispatch by hostname + path. Returns { status, contentType, body } or null for 404.
function dispatch(host, reqPath) {
  // Strip port from host if present.
  const bareHost = String(host || '').split(':')[0].toLowerCase();
  // Strip querystring.
  const bareePath = String(reqPath || '').split('?')[0];

  if (bareHost === 'www.wagtopia.com' || bareHost === 'wagtopia.com') {
    if (bareePath.startsWith('/search/pet')) {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: readFixture('wagtopia/search.html'),
      };
    }
  }

  if (bareHost === 's3.amazonaws.com') {
    if (bareePath === '/petstablished-test/luna.jpg') {
      return {
        status: 200,
        contentType: 'image/jpeg',
        body: readFixture('images/wagtopia-dog.jpg'),
      };
    }
  }

  if (bareHost === 'www.adoptapet.com' || bareHost === 'adoptapet.com') {
    if (bareePath.startsWith('/pet/')) {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: readFixture('adoptapet/pet.html'),
      };
    }
  }

  if (bareHost === 'media.adoptapet.com') {
    return {
      status: 200,
      contentType: 'image/jpeg',
      body: readFixture('images/adoptapet-dog.jpg'),
    };
  }

  return null;
}

function handleRequest(verbose, req, res, inferredHost) {
  // For HTTP proxy mode, req.url is absolute (e.g. http://host/path).
  // For TLS-terminated requests, req.url is the path and Host header has the host.
  let host;
  let reqPath;
  try {
    if (req.url && /^https?:\/\//i.test(req.url)) {
      const u = new URL(req.url);
      host = u.host;
      reqPath = u.pathname + (u.search || '');
    } else {
      host = inferredHost || req.headers.host || '';
      reqPath = req.url || '/';
    }
  } catch (err) {
    host = inferredHost || req.headers.host || '';
    reqPath = req.url || '/';
  }

  log(verbose, req.method, host, reqPath);

  let result;
  try {
    result = dispatch(host, reqPath);
  } catch (err) {
    log(verbose, 'fixture read error:', err.message);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`fixture read error: ${err.message}`);
    return;
  }

  if (!result) {
    const msg = `fixture not found: ${host}${reqPath}`;
    log(verbose, '404', msg);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(msg);
    return;
  }

  res.writeHead(result.status, {
    'content-type': result.contentType,
    'content-length': result.body.length,
  });
  res.end(result.body);
}

async function startProxy({ verbose = false, port = 0 } = {}) {
  // Generate a self-signed cert for TLS termination.
  // selfsigned v5 returns a Promise.
  const attrs = [{ name: 'commonName', value: 'fcg-e2e-proxy' }];
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'www.wagtopia.com' },
          { type: 2, value: 'wagtopia.com' },
          { type: 2, value: 'www.adoptapet.com' },
          { type: 2, value: 'adoptapet.com' },
          { type: 2, value: 'media.adoptapet.com' },
          { type: 2, value: 's3.amazonaws.com' },
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  // The TLS server terminates CONNECT tunnels and hands plain HTTP requests off
  // to handleRequest. We share one tls server for all hosts — the self-signed
  // cert has SANs for every fixture host.
  const tlsServer = https.createServer(
    { key: pems.private, cert: pems.cert },
    (req, res) => {
      // req.headers.host is the original host from the CONNECT target.
      handleRequest(verbose, req, res, req.headers.host);
    }
  );

  tlsServer.on('clientError', (err) => {
    log(verbose, 'tls clientError:', err.message);
  });

  // Listen on ephemeral port for the TLS server; CONNECT handler pipes to it.
  await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
  const tlsPort = tlsServer.address().port;
  log(verbose, 'tls termination listening on 127.0.0.1:' + tlsPort);

  // Main HTTP proxy server.
  const proxyServer = http.createServer((req, res) => {
    handleRequest(verbose, req, res);
  });

  // Handle HTTPS CONNECT: pipe the client socket to our local TLS server.
  proxyServer.on('connect', (req, clientSocket, head) => {
    log(verbose, 'CONNECT', req.url);

    const upstream = net.connect(tlsPort, '127.0.0.1', () => {
      clientSocket.write(
        'HTTP/1.1 200 Connection Established\r\n' +
          'Proxy-agent: fcg-e2e-proxy\r\n' +
          '\r\n'
      );
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', (err) => {
      log(verbose, 'upstream error:', err.message);
      try {
        clientSocket.end();
      } catch (_) {}
    });
    clientSocket.on('error', (err) => {
      log(verbose, 'client socket error:', err.message);
      try {
        upstream.end();
      } catch (_) {}
    });
  });

  proxyServer.on('clientError', (err) => {
    log(verbose, 'proxy clientError:', err.message);
  });

  await new Promise((resolve) => proxyServer.listen(port, '127.0.0.1', resolve));
  const actualPort = proxyServer.address().port;
  log(verbose, 'proxy listening on 127.0.0.1:' + actualPort);

  async function stop() {
    await new Promise((resolve) => proxyServer.close(() => resolve()));
    await new Promise((resolve) => tlsServer.close(() => resolve()));
  }

  return { port: actualPort, stop };
}

module.exports = { startProxy };

if (require.main === module) {
  const port = Number(process.env.PROXY_PORT || 8888);
  startProxy({ verbose: true, port })
    .then(({ port: p }) => {
      console.error(`[proxy] standalone mode, listening on 127.0.0.1:${p}`);
      console.error(
        `[proxy] try: curl -k --proxy http://127.0.0.1:${p} https://www.wagtopia.com/search/pet?id=1`
      );
    })
    .catch((err) => {
      console.error('[proxy] failed to start:', err);
      process.exit(1);
    });
}
