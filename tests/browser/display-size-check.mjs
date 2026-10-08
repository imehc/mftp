import fs from "node:fs";

import { evaluate, launchBrowser, navigate } from "./browser.mjs";
import { artifact, fixture } from "./paths.mjs";
const browser = await launchBrowser();
fs.writeFileSync(
  artifact("display-size-browser-version.json"),
  JSON.stringify(browser.version, null, 2),
);
try {
  const results = [];
  for (const width of [320, 767, 768]) {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(browser, fixture("display-size.html"));
    await evaluate(
      browser,
      `new Promise(resolve=>{const timer=setInterval(()=>{if(window.qa?.term&&document.querySelector('[role="dialog"]')){clearInterval(timer);resolve()}},50)})`,
    );
    const result = await evaluate(
      browser,
      `(async()=>{
    const wait=()=>new Promise(resolve=>setTimeout(resolve,200));
    const click=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)?.click();
    click('Adjust manually');await wait();click('125%');await wait();
    const root=parseFloat(getComputedStyle(document.documentElement).fontSize);
    const dialog=document.querySelector('[role="dialog"]');
    const rect=dialog.getBoundingClientRect();
    const fits=rect.left>=-1&&rect.right<=innerWidth+1&&dialog.scrollWidth<=dialog.clientWidth+1;
    const persisted=JSON.parse(localStorage.getItem('mftp-settings')).state.displaySize.scale===1.25;
    const terminal=window.qa.term.options.fontSize===16.25;
    const row=document.querySelector('[data-index="0"]');const virtual=Math.abs(row.getBoundingClientRect().height-50)<1;
    click('Close');await wait();
    const cal=document.querySelector('[data-slot="calendar"]')||document.querySelector('.group\\/calendar');
    const calendar=cal ? cal.getBoundingClientRect().width<=innerWidth+1 : false;
    document.getElementById('open').click();await wait();
    return {width:innerWidth,root,fits,persisted,terminal,virtual,calendar,passed:root===20&&fits&&persisted&&terminal&&virtual&&calendar};
  })()`,
    );
    results.push(result);
    const shot = await browser.send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      artifact(`mftp-d1-${width}.png`),
      Buffer.from(shot.data, "base64"),
    );
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(
    artifact("mftp-d1-browser.json"),
    JSON.stringify(results, null, 2),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
