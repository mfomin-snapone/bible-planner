import { chromium } from "playwright";

const browser = await chromium.launch();

async function register(context, uname) {
  const page = await context.newPage();
  const wsEvents = [];
  page.on("websocket", (ws) => {
    wsEvents.push(`OPEN ${ws.url()}`);
    ws.on("framereceived", (f) => wsEvents.push(`RECV ${String(f.payload).slice(0,120)}`));
    ws.on("framesent", (f) => wsEvents.push(`SENT ${String(f.payload).slice(0,120)}`));
    ws.on("close", () => wsEvents.push("CLOSED"));
    ws.on("socketerror", (e) => wsEvents.push(`ERROR ${e}`));
  });
  await page.goto("http://localhost:5173");
  await page.locator("text=New? Create an account").click();
  await page.fill("#acct-username", uname);
  await page.fill("#acct-password", "testpass123");
  await page.fill("#acct-dob", "1990-01-01");
  await page.locator("button:has-text('Create Account')").click();
  await page.waitForSelector("text=Community", { timeout: 15000 });
  const startPlanBtn = page.locator("button:has-text('Start the Plan')").first();
  if (await startPlanBtn.count()) { await startPlanBtn.click(); }
  await page.locator("text=Community").last().click();
  await page.waitForTimeout(1000);
  return { page, wsEvents };
}

const ctxA = await browser.newContext();
const uA = "wsdebug" + Date.now();
const { page: pageA, wsEvents } = await register(ctxA, uA);

await pageA.waitForTimeout(2000);
console.log("=== A's WS events ===");
console.log(wsEvents.join("\n"));

await browser.close();
