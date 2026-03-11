import { createZenblogClient } from "zenblog";

export const zenblog = createZenblogClient({
  blogId: process.env.ZENBLOG_BLOG_ID!,
});
