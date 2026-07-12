import { z } from "zod";

export const discordCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});
