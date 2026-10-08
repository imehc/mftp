import assert from "node:assert/strict";
import fs from "node:fs";

import { evaluate, launchBrowser, navigate } from "./browser.mjs";
import { artifact, fixture } from "./paths.mjs";
const browser = await launchBrowser();
const results = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 150));
async function click(selector) {
  await evaluate(
    browser,
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
  await wait();
}
async function key(key, code) {
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await wait();
}
async function select(label) {
  await evaluate(browser, `document.getElementById('ai-protocol').focus()`);
  await key(" ", "Space");
  await evaluate(
    browser,
    `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`,
  );
  await wait();
}
try {
  for (const width of [375, 900]) {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(browser, fixture("ai-protocol.html"));
    await evaluate(
      browser,
      `new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.getElementById('ai-protocol')){clearInterval(t);resolve()}else if(++n>200){clearInterval(t);reject(Error('fixture timeout'))}},50)})`,
    );
    assert.equal(
      await evaluate(
        browser,
        `document.getElementById('ai-protocol').textContent.trim()`,
      ),
      "Responses",
    );
    await select("Chat Completions");
    await evaluate(
      browser,
      `(()=>{const set=(id,value)=>{const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))};set('ai-name','Test');set('ai-url','https://example.invalid/v1');set('ai-key-label','test');set('ai-key-secret','fake-browser-key');set('ai-model-id','test-model');})()`,
    );
    await wait();
    await click('button[form="ai-editor"]');
    assert.equal(
      await evaluate(browser, `window.qa.calls.at(-1)?.protocol`),
      "chatCompletions",
    );
    await click("#edit");
    assert.equal(
      await evaluate(
        browser,
        `document.getElementById('ai-protocol').textContent.trim()`,
      ),
      "Chat Completions",
    );
    await select("Anthropic Messages");
    await click('button[form="ai-editor"]');
    assert.equal(
      await evaluate(browser, `window.qa.calls.at(-1)?.protocol`),
      "anthropicMessages",
    );
    await click("#edit");
    assert.equal(
      await evaluate(
        browser,
        `document.getElementById('ai-protocol').textContent.trim()`,
      ),
      "Anthropic Messages",
    );
    await select("Responses");
    await click('button[form="ai-editor"]');
    assert.equal(
      await evaluate(browser, `window.qa.calls.at(-1)?.protocol`),
      "responses",
    );
    await click("#new");
    assert.equal(
      await evaluate(browser, `document.getElementById('ai-key-secret').value`),
      "",
    );
    // A protocol-only draft must participate in the existing discard guard.
    await select("Chat Completions");
    await evaluate(
      browser,
      `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Cancel').click()`,
    );
    await wait();
    assert.equal(
      await evaluate(
        browser,
        `!!document.querySelector('[role="alertdialog"]')`,
      ),
      true,
    );
    await evaluate(
      browser,
      `[...document.querySelectorAll('[role="alertdialog"] button')].at(-1).click()`,
    );
    await wait();
    await click("#new");
    assert.equal(
      await evaluate(
        browser,
        `document.getElementById('ai-protocol').textContent.trim()`,
      ),
      "Responses",
    );
    const fits = await evaluate(
      browser,
      `(()=>{const d=document.querySelector('[role="dialog"]');const r=d.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&d.scrollWidth<=d.clientWidth+1})()`,
    );
    assert.ok(fits);
    const shot = await browser.send("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      artifact(`ai-protocol-${width}.png`),
      Buffer.from(shot.data, "base64"),
    );
    results.push({
      width,
      defaultResponses: true,
      create: true,
      editAllProtocols: true,
      discard: true,
      fits,
    });
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(
    artifact("ai-protocol-results.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
