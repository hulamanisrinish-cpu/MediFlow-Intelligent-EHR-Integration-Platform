CREATE TABLE `baseline_patient_metrics` (
	`patient_id` text PRIMARY KEY NOT NULL,
	`waited_min` integer NOT NULL,
	`visit_min` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "baseline_patient_waited_nonnegative" CHECK("baseline_patient_metrics"."waited_min" >= 0),
	CONSTRAINT "baseline_patient_visit_nonnegative" CHECK("baseline_patient_metrics"."visit_min" >= 0)
);
--> statement-breakpoint
ALTER TABLE `patients` ADD `emergency` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `plan_changes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Rebuild simulation_events with expanded type CHECK (SQLite cannot alter CHECK constraints)
CREATE TABLE `simulation_events_new` (
	`id` text PRIMARY KEY NOT NULL,
	`simulation_minute` integer NOT NULL,
	`type` text NOT NULL,
	`order_in_minute` integer NOT NULL,
	`patient_id` text,
	`resource_id` text,
	`payload` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "simulation_events_type_valid" CHECK("simulation_events_new"."type" in ('simulation_initialized', 'clock_advanced', 'patient_arrived', 'patient_queued', 'service_started', 'service_completed', 'recommendation_created', 'emergency_override', 'plan_changed')),
	CONSTRAINT "simulation_events_minute_nonnegative" CHECK("simulation_events_new"."simulation_minute" >= 0),
	CONSTRAINT "simulation_events_order_nonnegative" CHECK("simulation_events_new"."order_in_minute" >= 0)
);
--> statement-breakpoint
INSERT INTO `simulation_events_new` SELECT * FROM `simulation_events`;--> statement-breakpoint
DROP TABLE `simulation_events`;--> statement-breakpoint
ALTER TABLE `simulation_events_new` RENAME TO `simulation_events`;--> statement-breakpoint
CREATE INDEX `simulation_events_minute_idx` ON `simulation_events` (`simulation_minute`);--> statement-breakpoint
CREATE UNIQUE INDEX `simulation_events_minute_order_unique` ON `simulation_events` (`simulation_minute`,`order_in_minute`);--> statement-breakpoint
CREATE INDEX `simulation_events_patient_idx` ON `simulation_events` (`patient_id`);--> statement-breakpoint
CREATE INDEX `simulation_events_resource_idx` ON `simulation_events` (`resource_id`);