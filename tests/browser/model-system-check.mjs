import fs from "node:fs";

import { evaluate, launchBrowser, navigate } from "./browser.mjs";
import { artifact, fixture } from "./paths.mjs";
const browser = await launchBrowser();
fs.writeFileSync(
  artifact("model-system-browser-version.json"),
  JSON.stringify(browser.version, null, 2),
);
try {
  await navigate(browser, fixture("model-system.html"));
  const result = await evaluate(
    browser,
    `new Promise((resolve, reject) => {
    const deadline = Date.now() + 60000;
    const timer = setInterval(() => {
      const value = document.getElementById('result')?.textContent;
      if (value && value !== '运行中') { clearInterval(timer); resolve(JSON.parse(value)); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('QA timeout')); }
    }, 100);
  })`,
  );
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(
    artifact("mftp-c4-system-browser.json"),
    JSON.stringify(result, null, 2),
  );
  await evaluate(
    browser,
    `document.getElementById('panel').scrollIntoView(); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
  );
  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    artifact("mftp-c4-system-browser.png"),
    Buffer.from(shot.data, "base64"),
  );
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
