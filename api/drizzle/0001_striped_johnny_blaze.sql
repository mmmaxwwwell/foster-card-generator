PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cards_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
INSERT INTO `__new_cards_table`("id", "name", "age", "breed", "adoptionUrl", "gender", "size", "shots", "housetrained", "okWithKids", "okWithDogs", "okWithCats", "specialNeeds") SELECT "id", "name", "age", "breed", "adoptionUrl", "gender", "size", "shots", "housetrained", "okWithKids", "okWithDogs", "okWithCats", "specialNeeds" FROM `cards_table`;--> statement-breakpoint
DROP TABLE `cards_table`;--> statement-breakpoint
ALTER TABLE `__new_cards_table` RENAME TO `cards_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;