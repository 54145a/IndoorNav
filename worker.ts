/// <reference types="@cloudflare/workers-types" />
import app from "./app.js";
app.use("*", async (c) => {
	if (c.env.ASSETS) {
		return c.env.ASSETS.fetch(c.req.raw);
	}
	return c.text("Not Found", 404);
});
export default app;