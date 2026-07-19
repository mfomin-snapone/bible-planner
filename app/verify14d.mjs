import { chromium } from "playwright";

const SC = "/private/tmp/claude-501/-Users-mark-Projects-bible-planner/776804d8-c066-4e32-a1d8-6a300fc3c1d7/scratchpad";
const errors = [];
const browser = await chromium.launch();

async function register(context, uname) {
  const page = await context.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[${uname}] ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`[${uname}] ${String(err)}`));
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
  await page.waitForTimeout(300);
  return page;
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const uA = "admindel4" + Date.now();
const uB = "memberdel4" + Date.now();
const pageA = await register(ctxA, uA);
const pageB = await register(ctxB, uB);

await pageA.locator("button:has-text('New Group'), button:has-text('Create')").first().click();
await pageA.fill("input.groups-input", "Delete Test Group 4");
await pageA.locator("button[type=submit]:has-text('Create Group')").click();
await pageA.waitForSelector("text=Delete Test Group 4", { timeout: 10000 });
await pageA.locator("text=Delete Test Group 4").first().click();
await pageA.waitForSelector(".group-stat-num", { timeout: 10000 });
const inviteCode = (await pageA.locator(".group-stat-num").nth(3).innerText()).trim();
console.log("code", inviteCode);

await pageB.locator("[title='Join a group'], button:has-text('Join')").first().click();
await pageB.fill("input", inviteCode);
await pageB.locator("button:has-text('Look Up')").click();
await pageB.waitForSelector("button:has-text('Join')", { timeout: 10000 });
await pageB.locator("button:has-text('Join')").last().click();
await pageB.waitForTimeout(1500);

await pageA.locator("button:has-text('Group Chat')").click();
await pageA.waitForSelector(".chat-input", { timeout: 10000 });
await pageB.locator("text=Delete Test Group 4").first().click();
await pageB.waitForSelector("button:has-text('Group Chat')", { timeout: 10000 });
await pageB.locator("button:has-text('Group Chat')").click();
await pageB.waitForSelector(".chat-input", { timeout: 10000 });

await pageA.fill(".chat-input", "Message from admin");
await pageA.locator("button[aria-label='Send']").click();
await pageA.waitForSelector("text=Message from admin", { timeout: 10000 });

// wait for B to receive it live via WS, with generous timeout + poll
await pageB.waitForSelector("text=Message from admin", { timeout: 15000 });
console.log("B received A's message live via WS: YES");

await pageB.fill(".chat-input", "Message from member");
await pageB.locator("button[aria-label='Send']").click();
await pageB.waitForSelector("text=Message from member", { timeout: 10000 });
await pageA.waitForSelector("text=Message from member", { timeout: 15000 });
console.log("A received B's message live via WS: YES");

console.log("A bubble count:", await pageA.locator(".chat-bubble-row").count());
console.log("B bubble count:", await pageB.locator(".chat-bubble-row").count());

// Now test delete permissions properly
console.log("Delete buttons visible to A on B's (member's) message [admin moderation]:", await pageA.locator(".chat-theirs .chat-report-btn[title='Delete']").count());
console.log("Delete buttons visible to B on A's (admin's) message [should be 0, not own/not admin]:", await pageB.locator(".chat-theirs .chat-report-btn[title='Delete']").count());

// A (admin) deletes B's message
await pageA.locator(".chat-theirs .chat-report-btn[title='Delete']").last().click();
await pageA.waitForSelector("button:has-text('Delete')", { timeout: 5000 });
await pageA.locator(".report-modal button:has-text('Delete')").click();
await pageA.waitForSelector("text=This message has been deleted", { timeout: 10000 });
await pageA.screenshot({ path: `${SC}/f1-admin-deleted-view.png` });

// B should see the tombstone live too
await pageB.waitForSelector("text=This message has been deleted", { timeout: 15000 });
console.log("B saw tombstone live via WS: YES");
await pageB.screenshot({ path: `${SC}/f2-member-sees-tombstone-live.png` });

console.log("ERRORS:", JSON.stringify(errors, null, 2));
await browser.close();
