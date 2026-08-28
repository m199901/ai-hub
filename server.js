const http = require('node:http');

const port = Number.parseInt(process.env.PORT || '3000', 10);

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ name: 'ai-hub', status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ai-hub listening on port ${port}`);
});
