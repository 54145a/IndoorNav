import { defineConfig } from "vite";
import devServer, { defaultOptions } from "@hono/vite-dev-server";

export default defineConfig({
    plugins: [
        /*
            devServer({
                entry: "./server.ts",
                exclude: [
                    /\.html$/,
                    "/",
                    ...defaultOptions.exclude
                ]
            })
            */
    ]
});
