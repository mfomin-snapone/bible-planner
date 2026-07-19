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
const uA = "admindel" + Date.now();
const uB = "memberdel" + Date.now();
const pageA = await register(ctxA, uA);
const pageB = await register(ctxB, uB);

await pageA.locator("button:has-text('New Group'), button:has-text('Create')").first().click();
await pageA.waitForTimeout(300);
await pageA.fill("input.groups-input", "Delete Test Group");
await pageA.locator("button[type=submit]:has-text('Create Group')").click();
await pageA.waitForTimeout(800);
await pageA.locator("text=Delete Test Group").first().click();
await pageA.waitForTimeout(500);
const inviteCode = (await pageA.locator(".group-stat-num").nth(3).innerText()).trim();

await pageB.locator("[title='Join a group'], button:has-text('Join')").first().click();
await pageB.waitForTimeout(300);
await pageB.fill("input", inviteCode);
await pageB.waitForTimeout(150);
await pageB.locator("button:has-text('Look Up')").click();
await pageB.waitForTimeout(500);
await pageB.locator("button:has-text('Join')").last().click();
await pageB.waitForTimeout(800);

// Both open group chat
await pageA.locator("button:has-text('Group Chat')").click();
await pageA.waitForTimeout(500);
await pageB.locator("text=Delete Test Group").first().click();
await pageB.waitForTimeout(400);
await pageB.locator("button:has-text('Group Chat')").click();
await pageB.waitForTimeout(500);

// A sends a message
await pageA.fill(".chat-input", "Message from admin");
await pageA.locator("button[aria-label='Send']").click();
await pageA.waitForTimeout(600);
// B sends a message
await pageB.fill(".chat-input", "Message from member");
await pageB.locator("button[aria-label='Send']").click();
await pageB.waitForTimeout(600);

// B: check B does NOT see a delete button on A's message (not admin, not own)
const bubblesForB = await pageB.locator(".chat-bubble-row").count();
console.log("B sees", bubblesForB, "messages");
const deleteBtnsOnAdminMsgForB = await pageB.locator(".chat-theirs .chat-report-btn[title='Delete']").count();
console.log("Delete buttons visible to B on A's (admin's) message:", deleteBtnsOnAdminMsgForB, "(expect 0)");

// B deletes own message
await pageB.locator(".chat-mine .chat-report-btn[title='Delete']").first().click();
await pageB.waitForTimeout(200);
await pageB.locator("button:has-text('Delete')").last().click();
await pageB.waitForTimeout(600);
await pageB.screenshot({ path: `${SC}/d1-b-deleted-own.png` });

// A (admin) deletes... wait A's message is the "admin from admin" one; let's have A delete it via admin rights is trivial (own msg).
// Instead verify A can delete B's ALREADY message -- but B's message is now deleted. Let's have B send another, then A deletes it as admin.
await pageB.fill(".chat-input", "Second message from member");
await pageB.locator("button[aria-label='Send']").click();
await pageB.waitForTimeout(600);

await pageA.waitForTimeout(300);
await pageA.screenshot({ path: `${SC}/d2-a-view-before-admin-delete.png` });
const adminDeleteBtn = pageA.locator(".chat-theirs .chat-report-btn[title='Delete']").last();
console.log("Admin delete buttons visible to A on B's messages:", await pageA.locator(".chat-theirs .chat-report-btn[title='Delete']").count(), "(expect >=1)");
await adminDeleteBtn.click();
await pageA.waitForTimeout(200);
await pageA.locator("button:has-text('Delete')").last().click();
await pageA.waitForTimeout(600);
await pageA.screenshot({ path: `${SC}/d3-admin-deleted-member-msg.png` });

// Confirm B sees the tombstone live via WS too
await pageB.waitForTimeout(500);
await pageB.screenshot({ path: `${SC}/d4-b-sees-realtime-tombstone.png` });

console.log("ERRORS:", JSON.stringify(errors, null, 2));
await browser.close();
