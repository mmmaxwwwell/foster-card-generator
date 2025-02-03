CREATE TABLE `cards_table` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`breed` text NOT NULL,
	`adoptionUrl` text NOT NULL,
	`gender` text NOT NULL,
	`size` text NOT NULL,
	`shots` integer NOT NULL,
	`housetrained` integer NOT NULL,
	`okWithKids` integer NOT NULL,
	`okWithDogs` integer NOT NULL,
	`okWithCats` integer NOT NULL,
	`specialNeeds` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`age` integer NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_email_unique` ON `users_table` (`email`);