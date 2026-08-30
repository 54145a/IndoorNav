import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import devServer, { defaultOptions } from "@hono/vite-dev-server";

export default defineConfig({
    optimizeDeps: {
        exclude: ['recast-navigation']
    },
    plugins: [
        preact(),
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
