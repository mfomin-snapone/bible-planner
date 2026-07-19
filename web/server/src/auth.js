import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { isHostedDeployment } from "./env.js";

const TOKEN_TTL = "90d";

if (!process.env.JWT_SECRET && isHostedDeployment) {
  // A per-process random fallback is unsafe here: serverless platforms (Vercel) spin up
  // a fresh instance per cold start, so a token signed by one instance would fail
  // verification on another, causing intermittent "Invalid or expired token" errors.
  throw new Error(
    "[Bible-Planner] JWT_SECRET must be set in production. Generate one with " +
      "`openssl rand -hex 32` and set it as an environment variable on your host.",
  );
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "[Bible-Planner] JWT_SECRET not set — using a random secret for this process. " +
      "Existing tokens will be invalidated on every restart. Set JWT_SECRET in production.",
  );
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    req.username = payload.username;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Verify a raw token string and return its payload (for WS auth). */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
