CREATE TABLE "short_links" (
	"slug" text PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"campaign" text NOT NULL,
	"variant" text,
	"channel" text,
	"notes" text,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
