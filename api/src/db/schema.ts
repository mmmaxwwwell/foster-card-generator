import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const usersTable = sqliteTable("users_table", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  age: int().notNull(),
  email: text().notNull().unique(),
});

// Updated cardsTable with auto-increment id and updated DogProfile fields:
export const cardsTable = sqliteTable("cards_table", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  age: int().notNull(),
  breed: text().notNull(),
  adoptionUrl: text().notNull(),
  gender: text().notNull(),
  size: text().notNull(),
  shots: int().notNull(),
  housetrained: int().notNull(),
  okWithKids: int().notNull(),
  okWithDogs: int().notNull(),
  okWithCats: int().notNull(),
  specialNeeds: int().notNull(),
});