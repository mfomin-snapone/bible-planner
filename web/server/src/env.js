// Vercel (and most hosts) set NODE_ENV=production; VERCEL is set on Vercel specifically.
export const isHostedDeployment = Boolean(
  process.env.VERCEL || process.env.NODE_ENV === "production",
);
