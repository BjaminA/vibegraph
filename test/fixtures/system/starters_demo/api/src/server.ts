import http from "node:http";

const port = Number(process.env.PORT ?? 3000);
http.createServer((_req, res) => res.end("api")).listen(port);
