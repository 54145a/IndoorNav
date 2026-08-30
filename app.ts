import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
const app = new Hono<{ Bindings: { ASSETS?: Fetcher; }; }>();
app.use('*', basicAuth({
  username: "user",
  password: "changeme"
}));
app.get("/api/echo", (c) => {
  return c.text("hello from api");
});
export default app;
