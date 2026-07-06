import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";

const app = defineApp();
app.use(rateLimiter);
app.use(resend);
app.use(workpool, { name: "notificationPool" });
app.use(workflow);

export default app;
