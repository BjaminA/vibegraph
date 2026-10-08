import http from "node:http";

const port = Number(process.env.PORT ?? 3001);
http.createServer((_req, res) => res.end("worker")).listen(port);
