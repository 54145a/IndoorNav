import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app.ts";
const port = 3000;
console.info(`Serving static at port: ${port}`);
app.use("/*", serveStatic({ root: "./dist" }));
serve({
	fetch: app.fetch,
	port,
});
export default app;