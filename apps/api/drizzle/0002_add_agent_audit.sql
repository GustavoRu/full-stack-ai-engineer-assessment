ALTER TABLE "questions" ADD COLUMN "mode" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "searches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "model_calls" integer DEFAULT 1 NOT NULL;