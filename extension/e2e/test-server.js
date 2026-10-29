import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 0;
const networkRequests = new Map();

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	if (url.pathname === '/network-first-request') {
		res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
		return res.end(`<!doctype html><html><head><script>
			fetch('/__network/early', { cache: 'no-store' }).then(response => response.json())
				.then(result => { document.documentElement.dataset.firstNetworkResult = JSON.stringify(result); })
				.catch(error => { document.documentElement.dataset.firstNetworkResult = JSON.stringify({ error: error.message }); });
		</script></head><body>Immediate network request</body></html>`);
	}
	if (url.pathname === '/__network/count') {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
		return res.end(JSON.stringify({ count: networkRequests.get(url.searchParams.get('path')) || 0 }));
	}
	if (url.pathname.startsWith('/__network/')) {
		networkRequests.set(url.pathname, (networkRequests.get(url.pathname) || 0) + 1);
		res.writeHead(req.method === 'OPTIONS' ? 204 : 200, {
			'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Legacy': 'original'
		});
		return res.end(req.method === 'OPTIONS' ? undefined : JSON.stringify({
			url: req.url, method: req.method, headers: req.headers
		}));
	}
	const filePath = path.join(__dirname, 'test-page.html');

	fs.readFile(filePath, 'utf8', (err, content) => {
		if (err) {
			res.writeHead(500);
			return res.end('Error loading test page');
		}

		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(content);
	});
});

server.listen(PORT, () => {
	const address = server.address();
	const actual = typeof address === 'object' && address ? address.port : PORT;
	console.log(`🧪 Playground running at http://127.0.0.1:${actual}`);
});
