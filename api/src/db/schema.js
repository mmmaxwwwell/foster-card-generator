"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cardsTable = exports.usersTable = void 0;
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
exports.usersTable = (0, sqlite_core_1.sqliteTable)("users_table", {
    id: (0, sqlite_core_1.int)().primaryKey({ autoIncrement: true }),
    name: (0, sqlite_core_1.text)().notNull(),
    age: (0, sqlite_core_1.int)().notNull(),
    email: (0, sqlite_core_1.text)().notNull().unique(),
});
// Updated cardsTable with auto-increment id and updated DogProfile fields:
exports.cardsTable = (0, sqlite_core_1.sqliteTable)("cards_table", {
    id: (0, sqlite_core_1.int)().primaryKey({ autoIncrement: true }),
    name: (0, sqlite_core_1.text)().notNull(),
    age: (0, sqlite_core_1.int)().notNull(),
    breed: (0, sqlite_core_1.text)().notNull(),
    adoptionUrl: (0, sqlite_core_1.text)().notNull(),
    gender: (0, sqlite_core_1.text)().notNull(),
    size: (0, sqlite_core_1.text)().notNull(),
    shots: (0, sqlite_core_1.int)().notNull(),
    housetrained: (0, sqlite_core_1.int)().notNull(),
    okWithKids: (0, sqlite_core_1.int)().notNull(),
    okWithDogs: (0, sqlite_core_1.int)().notNull(),
    okWithCats: (0, sqlite_core_1.int)().notNull(),
    specialNeeds: (0, sqlite_core_1.int)().notNull(),
});
