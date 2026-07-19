import { chromium } from "playwright";

const SC = "/private/tmp/claude-501/-Users-mark-Projects-bible-planner/776804d8-c066-4e32-a1d8-6a300fc3c1d7/scratchpad";
const errors = [];
const browser = await chromium.launch();

async function register(context, uname) {
  const page = await context.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[${uname}] ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`[${uname}] ${String(err)}`));
  await page.goto("http://localhost:5173");
  await page.waitForTimeout(300);
  await page.locator("text=New? Create an account").click();
  await page.waitForTimeout(200);
  await page.fill("#acct-username", uname);
  await page.fill("#acct-password", "testpass123");
  await page.fill("#acct-dob", "1990-01-01");
  await page.waitForTimeout(150);
  await page.locator("button:has-text('Create Account')").click();
  await page.waitForTimeout(1000);
  const startPlanBtn = page.locator("button:has-text('Start the Plan')").first();
  if (await startPlanBtn.count()) { await startPlanBtn.click(); await page.waitForTimeout(300); }
  await page.locator("text=Community").last().click();
  await page.waitForTimeout(300);
  return page;
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const uA = "admindel2" + Date.now();
const uB = "memberdel2" + Date.now();
const pageA = await register(ctxA, uA);
const pageB = await register(ctxB, uB);

await pageA.locator("button:has-text('New Group'), button:has-text('Create')").first().click();
await pageA.waitForTimeout(300);
await pageA.fill("input.groups-input", "Delete Test Group 2");
await pageA.locator("button[type=submit]:has-text('Create Group')").click();
await pageA.waitForTimeout(800);
await pageA.locator("text=Delete Test Group 2").first().click();
await pageA.waitForTimeout(500);
const inviteCode = (await pageA.locator(".group-stat-num").nth(3).innerText()).trim();
console.log("invite code", inviteCode);

await pageB.locator("[title='Join a group'], button:has-text('Join')").first().click();
await pageB.waitForTimeout(300);
await pageB.fill("input", inviteCode);
await pageB.waitForTimeout(150);
await pageB.locator("button:has-text('Look Up')").click();
await pageB.waitForTimeout(500);
await pageB.locator("button:has-text('Join')").last().click();
await pageB.waitForTimeout(1000);

await pageA.locator("button:has-text('Group Chat')").click();
await pageA.waitForTimeout(800);
await pageB.locator("text=Delete Test Group 2").first().click();
await pageB.waitForTimeout(500);
await pageB.locator("button:has-text('Group Chat')").click();
await pageB.waitForTimeout(800);

await pageA.fill(".chat-input", "Message from admin");
await pageA.locator("button[aria-label='Send']").click();
await pageA.waitForTimeout(1000);

await pageB.fill(".chat-input", "Message from member");
await pageB.locator("button[aria-label='Send']").click();
await pageB.waitForTimeout(1000);

await pageA.screenshot({ path: `${SC}/dbg-a-view.png` });
await pageB.screenshot({ path: `${SC}/dbg-b-view.png` });

console.log("A bubbles:", await pageA.locator(".chat-bubble-row").count());
console.log("B bubbles:", await pageB.locator(".chat-bubble-row").count());
console.log("A chat-report-btn count (all, incl delete via same class):", await pageA.locator(".chat-report-btn").count());
for (const el of await pageA.locator(".chat-report-btn").all()) {
  console.log("  A btn title:", await el.getAttribute("title"));
}

console.log("ERRORS:", JSON.stringify(errors, null, 2));
await browser.close();
