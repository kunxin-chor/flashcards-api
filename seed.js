const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();
const { ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");

const { connect } = require("./db");

function coerceObjectId(value) {
  if (!value) return value;

  if (value instanceof ObjectId) return value;

  if (typeof value === "string") {
    return new ObjectId(value);
  }

  if (typeof value === "object" && typeof value.$oid === "string") {
    return new ObjectId(value.$oid);
  }

  return value;
}

async function loadJson(relativePath) {
  const abs = path.join(__dirname, relativePath);
  const raw = await fs.readFile(abs, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const dbname = process.env.DB_NAME;
  const mongoUri = process.env.MONGO_URI;

  if (!dbname) {
    throw new Error("Missing env var DB_NAME");
  }

  if (!mongoUri) {
    throw new Error("Missing env var MONGO_URI");
  }

  const db = await connect(mongoUri, dbname);

  const users = await loadJson("mock_data/users.json");
  const flashcards = await loadJson("mock_data/flashcards.json");

  const usersCollection = db.collection("users");
  const flashcardsCollection = db.collection("flashcards");

  // Users: ensure _id is ObjectId and password is hashed
  const preparedUsers = [];
  for (const u of users) {
    const next = { ...u };
    next._id = coerceObjectId(next._id);

    if (typeof next.password === "string" && next.password.length > 0) {
      next.password = await bcrypt.hash(next.password, 10);
    }

    preparedUsers.push(next);
  }

  if (preparedUsers.length === 0) {
    throw new Error("No users found in mock_data/users.json");
  }

  const seededUserId = preparedUsers[0]._id;

  // Flashcards: keep existing shape; upsert by `id` if present
  const preparedFlashcards = flashcards.map((f) => {
    const next = { ...f };
    next.userId = next.userId ? coerceObjectId(next.userId) : seededUserId;
    return next;
  });

  for (const user of preparedUsers) {
    if (!user._id || !(user._id instanceof ObjectId)) {
      throw new Error("User is missing a valid _id ObjectId");
    }

    await usersCollection.replaceOne({ _id: user._id }, user, { upsert: true });
  }

  for (const card of preparedFlashcards) {
    if (typeof card.id === "number") {
      await flashcardsCollection.replaceOne({ id: card.id }, card, { upsert: true });
    } else {
      await flashcardsCollection.insertOne(card);
    }
  }

  console.log(`Seed complete: users=${preparedUsers.length}, flashcards=${preparedFlashcards.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
