import { querySelectorAll } from "../../strict-queryselector/index.js";
const b = querySelectorAll("button#b", HTMLButtonElement)[0];
b.textContent = "Hello World!";
