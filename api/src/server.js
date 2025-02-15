"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const libsql_1 = require("drizzle-orm/libsql");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("./db/schema");
const DogProfile_1 = require("./models/DogProfile");
const path_1 = __importDefault(require("path"));
const static_1 = __importDefault(require("@fastify/static"));
const db = (0, libsql_1.drizzle)(process.env.DB_FILE_NAME);
const fastify_1 = __importDefault(require("fastify"));
const fastify = (0, fastify_1.default)({ logger: true });
fastify.register(static_1.default, {
    root: path_1.default.join(__dirname, '..', 'assets'),
});
// Seed the database idempotently with two fake dogs
function seedDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        // Check and insert first dog if not exists using adoptionUrl as unique field
        const existingDog1 = yield db.select().from(schema_1.cardsTable).where((0, drizzle_orm_1.eq)(schema_1.cardsTable.adoptionUrl, "http://example.com/buddy"));
        if (!existingDog1.length) {
            // Pass undefined for id so auto-increment works
            const dog1 = new DogProfile_1.DogProfile(undefined, "Buddy", 3, "Golden Retriever", "http://example.com/buddy", "Male", "Large", 1, 1, 1, 1, 1, 0);
            yield db.insert(schema_1.cardsTable).values(dog1);
        }
        // Check and insert second dog if not exists using adoptionUrl as unique field
        const existingDog2 = yield db.select().from(schema_1.cardsTable).where((0, drizzle_orm_1.eq)(schema_1.cardsTable.adoptionUrl, "http://example.com/bella"));
        if (!existingDog2.length) {
            const dog2 = new DogProfile_1.DogProfile(undefined, "Bella", 4, "Labrador", "http://example.com/bella", "Female", "Medium", 1, 1, 1, 1, 1, 0);
            yield db.insert(schema_1.cardsTable).values(dog2);
        }
    });
}
fastify.get('/hello', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    return { hello: 'world' };
}));
fastify.get('/', (request, reply) => {
    return reply.sendFile('index.html');
});
// Create new card
fastify.post('/cards', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const profile = request.body;
        // Remove id if provided so DB can auto-increment
        const { id } = profile, data = __rest(profile, ["id"]);
        yield db.insert(schema_1.cardsTable).values(data);
        return { success: true, message: 'Card created successfully' };
    }
    catch (error) {
        reply.code(500);
        return { success: false, error: 'Failed to create card' };
    }
}));
// Get all cards
fastify.get('/cards', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cards = yield db.select().from(schema_1.cardsTable);
        return { success: true, data: cards };
    }
    catch (error) {
        reply.code(500);
        return { success: false, error: 'Failed to fetch cards' };
    }
}));
// Get single card by ID
fastify.get('/cards/:id', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = request.params;
        const card = yield db.select().from(schema_1.cardsTable).where((0, drizzle_orm_1.eq)(schema_1.cardsTable.id, Number(id)));
        if (!card.length) {
            reply.code(404);
            return { success: false, error: 'Card not found' };
        }
        return { success: true, data: card[0] };
    }
    catch (error) {
        reply.code(500);
        return { success: false, error: 'Failed to fetch card' };
    }
}));
// Update card
fastify.put('/cards/:id', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = request.params;
        const updates = request.body;
        const toNumber = (v) => {
            if (typeof v === 'boolean')
                return v ? 1 : 0;
            if (typeof v === 'number')
                return v;
            if (typeof v === 'string') {
                const lower = v.toLowerCase();
                if (lower === 'true')
                    return 1;
                if (lower === 'false')
                    return 0;
                const parsed = Number(v);
                return isNaN(parsed) ? 0 : parsed;
            }
            return 0;
        };
        const updatedFields = Object.assign({}, updates);
        if (updates.shots !== undefined) {
            updatedFields.shots = toNumber(updates.shots);
        }
        if (updates.housetrained !== undefined) {
            updatedFields.housetrained = toNumber(updates.housetrained);
        }
        if (updates.okWithKids !== undefined) {
            updatedFields.okWithKids = toNumber(updates.okWithKids);
        }
        if (updates.okWithDogs !== undefined) {
            updatedFields.okWithDogs = toNumber(updates.okWithDogs);
        }
        if (updates.okWithCats !== undefined) {
            updatedFields.okWithCats = toNumber(updates.okWithCats);
        }
        if (updates.specialNeeds !== undefined) {
            updatedFields.specialNeeds = toNumber(updates.specialNeeds);
        }
        yield db.update(schema_1.cardsTable)
            .set(updatedFields)
            .where((0, drizzle_orm_1.eq)(schema_1.cardsTable.id, Number(id)));
        return { success: true, message: 'Card updated successfully' };
    }
    catch (error) {
        reply.code(500);
        return { success: false, error: 'Failed to update card' };
    }
}));
// Delete card
fastify.delete('/cards/:id', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = request.params;
        yield db.delete(schema_1.cardsTable)
            .where((0, drizzle_orm_1.eq)(schema_1.cardsTable.id, Number(id)));
        return { success: true, message: 'Card deleted successfully' };
    }
    catch (error) {
        reply.code(500);
        return { success: false, error: 'Failed to delete card' };
    }
}));
// Replace fastify.listen with an async IIFE to seed the DB then start the server
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield seedDatabase();
        fastify.listen({ port: 3000 }, (err, address) => {
            if (err) {
                fastify.log.error(err);
                process.exit(1);
            }
            console.log(`Server listening at ${address}`);
        });
    }
    catch (error) {
        console.error("Failed to seed database", error);
        process.exit(1);
    }
}))();
