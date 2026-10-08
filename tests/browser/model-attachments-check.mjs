import fs from "node:fs";

import { evaluate, launchBrowser, navigate } from "./browser.mjs";
import { artifact, fixture } from "./paths.mjs";
const browser = await launchBrowser();
const results = [];
fs.writeFileSync(
  artifact("model-attachments-browser-version.json"),
  JSON.stringify(browser.version, null, 2),
);
try {
  for (const [width, dark, font] of [
    [320, true, 20],
    [900, false, 16],
  ]) {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(browser, fixture("model-attachments.html"));
    await evaluate(
      browser,
      `document.documentElement.classList.toggle('dark',${dark}); document.documentElement.style.fontSize='${font}px';`,
    );
    await evaluate(
      browser,
      `new Promise((resolve,reject)=>{const end=Date.now()+10000;const timer=setInterval(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='View');if(button&&!button.disabled){clearInterval(timer);button.click();resolve(true)}else if(Date.now()>end){clearInterval(timer);reject(new Error('No View button'))}},100)})`,
    );
    await evaluate(
      browser,
      `new Promise((resolve,reject)=>{const end=Date.now()+10000;const timer=setInterval(()=>{if(document.querySelector('pre')){clearInterval(timer);resolve(true)}else if(Date.now()>end){clearInterval(timer);reject(new Error('No preview'))}},100)})`,
    );
    const result = await evaluate(
      browser,
      `(()=>{const dialog=document.querySelector('[role=dialog]'); const preview=document.querySelector('pre');return {width:${width},dialogWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth,textPreserved:preview.textContent===window.qaText,executed:!!window.qaExecuted,embedded:dialog.querySelectorAll('iframe,img,object,embed,script,a[href]').length,remoteRequests:performance.getEntriesByType('resource').filter(r=>r.name.includes('invalid.example')).length}})()`,
    );
    results.push(result);
    const shot = await browser.send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      artifact(`mftp-c3-ui-${width}.png`),
      Buffer.from(shot.data, "base64"),
    );
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(
    artifact("mftp-c3-browser.json"),
    JSON.stringify(results, null, 2),
  );
  if (
    results.some(
      (r) =>
        !r.textPreserved ||
        r.executed ||
        r.embedded ||
        r.remoteRequests ||
        r.scrollWidth > r.dialogWidth,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
