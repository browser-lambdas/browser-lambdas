import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 0;

const server = http.createServer((req, res) => {
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
