import { createServer } from "node:http";
import { getUserFiles } from "../src/db/repository.js";

createServer(async (request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }

  try {
    await getUserFiles(0);
    response.writeHead(200, { "Content-Type": "text/plain" }).end("ok\n");
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain" }).end("unavailable\n");
  }
}).listen(8080, "0.0.0.0");
