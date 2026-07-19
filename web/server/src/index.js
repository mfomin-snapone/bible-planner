import { createServer } from "node:http";
import { app } from "./app.js";
import { createWsServer } from "./ws.js";

const port = Number(process.env.PORT || 8787);
const httpServer = createServer(app);
createWsServer(httpServer);

httpServer.listen(port, () => {
  console.log(`[Shema Study] API listening on http://localhost:${port}`);
});
