import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { usersTable, cardsTable } from './db/schema';
import { DogProfile } from './models/DogProfile';
  
const db = drizzle(process.env.DB_FILE_NAME!);

import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

// Seed the database idempotently with two fake dogs
async function seedDatabase() {
  // Check and insert first dog if not exists
  const existingDog1 = await db.select().from(cardsTable).where(eq(cardsTable.id, "dog1"));
  if (!existingDog1.length) {
    const dog1 = new DogProfile(
      "dog1", "Buddy", 3, "Golden Retriever",
      "http://example.com/buddy", "Male", "Large",
      1, 1, 1, 1, 1, 0
    );
    await db.insert(cardsTable).values(dog1);
  }
  // Check and insert second dog if not exists
  const existingDog2 = await db.select().from(cardsTable).where(eq(cardsTable.id, "dog2"));
  if (!existingDog2.length) {
    const dog2 = new DogProfile(
      "dog2", "Bella", 4, "Labrador",
      "http://example.com/bella", "Female", "Medium",
      1, 1, 1, 1, 1, 0
    );
    await db.insert(cardsTable).values(dog2);
  }
}

fastify.get('/', async (request, reply) => {
  return { hello: 'world' };
});

// Create new card
fastify.post('/cards', async (request, reply) => {
  try {
    // Accepting a complete DogProfile from the request body
    const profile = request.body as DogProfile;
    // Optionally create an instance if additional initialization is needed:
    // const dogProfile = new DogProfile(profile.id, profile.name, profile.age, profile.breed, profile.adoptionUrl, profile.gender, profile.size, profile.shots, profile.housetrained, profile.okWithKids, profile.okWithDogs, profile.okWithCats, profile.specialNeeds);

    await db.insert(cardsTable).values(profile);
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
    const card = await db.select().from(cardsTable).where(eq(cardsTable.id, id));
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

    // Updated toNumber to handle string values as well
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
      .where(eq(cardsTable.id, id));
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
      .where(eq(cardsTable.id, id));
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