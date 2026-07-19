import { chromium } from "playwright";
const SC = "/private/tmp/claude-501/-Users-mark-Projects-bible-planner/776804d8-c066-4e32-a1d8-6a300fc3c1d7/scratchpad";
const browser = await chromium.launch();

async function register(context, uname) {
  const page = await context.newPage();
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
const uA = "admindel3" + Date.now();
const uB = "memberdel3" + Date.now();
const pageA = await register(ctxA, uA);
const pageB = await register(ctxB, uB);

await pageA.locator("button:has-text('New Group'), button:has-text('Create')").first().click();
await pageA.waitForTimeout(300);
await pageA.fill("input.groups-input", "Delete Test Group 3");
await pageA.locator("button[type=submit]:has-text('Create Group')").click();
await pageA.waitForTimeout(800);
await pageA.locator("text=Delete Test Group 3").first().click();
await pageA.waitForTimeout(500);
const inviteCode = (await pageA.locator(".group-stat-num").nth(3).innerText()).trim();

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
await pageA.fill(".chat-input", "Message from admin");
await pageA.locator("button[aria-label='Send']").click();
await pageA.waitForTimeout(1000);

// B navigates into chat AFTER A already sent - does B see A's message on initial fetch?
await pageB.locator("text=Delete Test Group 3").first().click();
await pageB.waitForTimeout(500);
await pageB.locator("button:has-text('Group Chat')").click();
await pageB.waitForTimeout(1000);
console.log("B bubbles on fresh chat open (should include A's message):", await pageB.locator(".chat-bubble-row").count());
await pageB.screenshot({ path: `${SC}/dbg2-b-fresh-open.png` });
