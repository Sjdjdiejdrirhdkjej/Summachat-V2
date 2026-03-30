import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const imageStatusSchema = z.enum(["ready", "blocked", "failed"]);

export const generatedImages = pgTable("generated_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonymousOwnerIdHash: text("anonymous_owner_id_hash").notNull(),
  originalPrompt: text("original_prompt").notNull(),
  enhancedPrompt: text("enhanced_prompt").notNull(),
  providerRevisedPrompt: text("provider_revised_prompt"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  routingReason: text("routing_reason").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  storageBackend: text("storage_backend").notNull(),
  storageKey: text("storage_key").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertGeneratedImageSchema = createInsertSchema(
  generatedImages,
).extend({
  status: imageStatusSchema,
});

export type GeneratedImage = typeof generatedImages.$inferSelect;
export type InsertGeneratedImage = z.infer<typeof insertGeneratedImageSchema>;
