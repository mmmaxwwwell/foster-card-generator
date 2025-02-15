import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { usersTable, cardsTable } from './db/schema';
import { DogProfile } from './models/DogProfile';
import path from 'path';
import fastifyStatic from '@fastify/static';

const db = drizzle(process.env.DB_FILE_NAME!);

import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'assets'),
});

// Seed the database idempotently with two fake dogs
async function seedDatabase() {
  // Check and insert first dog if not exists using adoptionUrl as unique field
  const existingDog1 = await db.select().from(cardsTable).where(eq(cardsTable.adoptionUrl, "http://example.com/buddy"));
  if (!existingDog1.length) {
    // Pass undefined for id so auto-increment works
    const dog1 = new DogProfile(
      undefined, "Buddy", 3, "Golden Retriever",
      "http://example.com/buddy", "Male", "Large",
      1, 1, 1, 1, 1, 0
    );
    await db.insert(cardsTable).values(dog1);
  }
  // Check and insert second dog if not exists using adoptionUrl as unique field
  const existingDog2 = await db.select().from(cardsTable).where(eq(cardsTable.adoptionUrl, "http://example.com/bella"));
  if (!existingDog2.length) {
    const dog2 = new DogProfile(
      undefined, "Bella", 4, "Labrador",
      "http://example.com/bella", "Female", "Medium",
      1, 1, 1, 1, 1, 0
    );
    await db.insert(cardsTable).values(dog2);
  }
}

fastify.get('/hello', async (request, reply) => {
  return { hello: 'world' };
});

fastify.get('/', (request, reply) => {
  return reply.sendFile('index.html');
});

// Create new card
fastify.post('/cards', async (request, reply) => {
  try {
    const profile = request.body as DogProfile;
    // Remove id if provided so DB can auto-increment
    const { id, ...data } = profile;
    await db.insert(cardsTable).values(data);
    return { success: true, message: 'Card created successfully' };
  } catch (error) {
    reply.code(500);
    return { success: false, error: 'Failed to create card' };
  }
});

// Get all cards
fastify.get('/cards', async (request, reply) => {
  try {
    const cards = await db.select().from(cardsTable);
    return { success: true, data: cards };
  } catch (error) {
    reply.code(500);
    return { success: false, error: 'Failed to fetch cards' };
  }
});

// Get single card by ID
fastify.get('/cards/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const card = await db.select().from(cardsTable).where(eq(cardsTable.id, Number(id)));
    if (!card.length) {
      reply.code(404);
      return { success: false, error: 'Card not found' };
    }
    return { success: true, data: card[0] };
  } catch (error) {
    reply.code(500);
    return { success: false, error: 'Failed to fetch card' };
  }
});

// Update card
fastify.put('/cards/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<DogProfile> & { [key: string]: boolean | number | string };

    const toNumber = (v: boolean | number | string): number => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const lower = v.toLowerCase();
        if (lower === 'true') return 1;
        if (lower === 'false') return 0;
        const parsed = Number(v);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };

    const updatedFields: Partial<DogProfile> = { ...updates };
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

    await db.update(cardsTable)
      .set(updatedFields)
      .where(eq(cardsTable.id, Number(id)));
    return { success: true, message: 'Card updated successfully' };
  } catch (error) {
    reply.code(500);
    return { success: false, error: 'Failed to update card' };
  }
});

// Delete card
fastify.delete('/cards/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    await db.delete(cardsTable)
      .where(eq(cardsTable.id, Number(id)));
    return { success: true, message: 'Card deleted successfully' };
  } catch (error) {
    reply.code(500);
    return { success: false, error: 'Failed to delete card' };
  }
});

// Replace fastify.listen with an async IIFE to seed the DB then start the server
(async () => {
  try {
    await seedDatabase();
    fastify.listen({ port: 3000 }, (err, address) => {
      if (err) {
        fastify.log.error(err);
        process.exit(1);
      }
      console.log(`Server listening at ${address}`);
    });
  } catch (error) {
    console.error("Failed to seed database", error);
    process.exit(1);
  }
})();