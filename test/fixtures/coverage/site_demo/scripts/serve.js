// Serve the built site locally.
const http = require("node:http");
http.createServer((req, res) => res.end("ok")).listen(8080);
