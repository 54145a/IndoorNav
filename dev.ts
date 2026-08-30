import { spawn } from "node:child_process";
const viteProcess = spawn("vite", {
    shell: true,
    stdio: "inherit"
});
const children = [
    viteProcess,
    spawn("node --experimental-strip-types server.ts", {
        shell: true,
        stdio: "inherit"
    })
];
children.forEach(p => p.on("exit", code => {
    children.forEach(v => v.kill());
    process.exit(code);
}));