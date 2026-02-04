const express = require('express');
const cors = require("cors");
require("dotenv").config();
const { ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const { connect } = require('./db');
const dbname = process.env.DB_NAME;
const mongoUri = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET;
const { generateAssistantResponse } = require('./gemini');

const app = express();
app.use(express.json())
app.use(cors());

function authRequired(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Missing Authorization Bearer token" });
    }

    if (!jwtSecret) {
        return res.status(500).json({ message: "Server misconfigured: missing JWT_SECRET" });
    }

    const token = header.slice("Bearer ".length);
    try {
        const payload = jwt.verify(token, jwtSecret);
        req.user = { userId: new ObjectId(payload.userId) };
        return next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }
}

async function main() {
    const db = await connect(mongoUri, dbname);

    const usersCollection = db.collection("users");
    const flashcardsCollection = db.collection("flashcards");

    app.post("/register", async (req, res) => {
        try {
            const { username, email, password } = req.body || {};
            if (!username || !email || !password) {
                return res.status(400).json({ message: "username, email and password are required" });
            }

            const existing = await usersCollection.findOne({ $or: [{ email }, { username }] });
            if (existing) {
                return res.status(409).json({ message: "User already exists" });
            }

            const userDoc = {
                username,
                email,
                password: await bcrypt.hash(password, 10),
            };

            const result = await usersCollection.insertOne(userDoc);
            return res.status(201).json({ _id: result.insertedId, username, email });
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({ message: "email and password are required" });
            }

            const user = await usersCollection.findOne({ email });
            if (!user) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            const ok = await bcrypt.compare(password, user.password);
            if (!ok) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            if (!jwtSecret) {
                return res.status(500).json({ message: "Server misconfigured: missing JWT_SECRET" });
            }

            const token = jwt.sign(
                { userId: user._id.toString() },
                jwtSecret,
                { expiresIn: "7d" }
            );

            return res.json({ token });
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.get("/flashcards", async (req, res) => {
        try {
            const cards = await flashcardsCollection.find({}).sort({ id: 1 }).toArray();
            return res.json(cards);
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.get("/flashcards/:id", async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid id" });
            }

            const card = await flashcardsCollection.findOne({ _id: new ObjectId(id) });
            if (!card) {
                return res.status(404).json({ message: "Not found" });
            }

            return res.json(card);
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.post("/flashcards", authRequired, async (req, res) => {
        try {
            const { front, back } = req.body || {};
            if (!front || !back) {
                return res.status(400).json({ message: "front and back are required" });
            }

        

            const doc = {
                front,
                back,
                userId: req.user.userId,
            };

            const results= await flashcardsCollection.insertOne(doc);
            return res.status(201).json({...doc, id: results.insertedId });
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.put("/flashcards/:id", authRequired, async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid id" });
            }

            const { front, back } = req.body || {};
            const set = {};
            if (typeof front === "string") set.front = front;
            if (typeof back === "string") set.back = back;
            if (Object.keys(set).length === 0) {
                return res.status(400).json({ message: "Nothing to update" });
            }

            const result = await flashcardsCollection.findOneAndUpdate(
                { _id: new ObjectId(id), userId: req.user.userId },
                { $set: set },
                { returnDocument: "after" }
            );

            if (!result.value) {
                const exists = await flashcardsCollection.findOne({ _id: new ObjectId(id) });
                if (!exists) return res.status(404).json({ message: "Not found" });
                return res.status(403).json({ message: "Forbidden" });
            }

            return res.json(result.value);
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

    app.delete("/flashcards/:id", authRequired, async (req, res) => {
        try {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid id" });
            }

            const result = await flashcardsCollection.deleteOne({ _id: new ObjectId(id), userId: req.user.userId });
            if (result.deletedCount === 0) {
                const exists = await flashcardsCollection.findOne({ _id: new ObjectId(id) });
                if (!exists) return res.status(404).json({ message: "Not found" });
                return res.status(403).json({ message: "Forbidden" });
            }

            return res.status(204).send();
        } catch (err) {
            return res.status(500).json({ message: "Server error" });
        }
    });

     app.post("/assistant", authRequired, async(req,res, next) => {
        try {

            const userId = req.user.userId;
            const message = req.body.message;
            const response = await generateAssistantResponse(userId, message);
            res.json(response);
   
        } catch (err) {
            next(err);
            console.error(err);
            res.status(500).json({ message: "Server error" });
        }
    })

    app.listen(port, function () {
        console.log("Server has started");
    })

   
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});