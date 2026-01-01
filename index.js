const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = process.env.Port || 3000;
const serviceAccount = require("./book-courier-server-firebase-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middlewar
app.use(express.json());
app.use(cors());

//verify firebase token
const verifyFBToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

const uri = process.env.URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("book-courier-db");
    const usersCollection = db.collection("users");
    const booksCollection = db.collection("books");

    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const query = { email: req.decoded_email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    //verify librarian
    const verifyLibrarian = async (req, res, next) => {
      const query = { email: req.decoded_email };
      const user = await usersCollection.findOne(query);
      console.log(user);
      if (!user || user?.role !== "librarian") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    //user related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "User Already Axist" });
      }
      user.createdAt = new Date();
      user.role = "user";
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role || "user" });
    });

    //book related apis

    app.get("/books", verifyFBToken, verifyLibrarian, async (req, res) => {
      const { email, status } = req.query;
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = {};
      if (email) {
        query.authorEmail = email;
      }
      if (status) {
        query.status = status;
      }
      const result = await booksCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/books", verifyFBToken, async (req, res) => {
      const book = req.body;
      book.createdAt = new Date();
      if (book.status === "published") {
        book.publishedAt = new Date();
      }
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });
    app.get("/book-details/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.log(error);
  }
}

app.get("/", async (req, res) => {
  res.send("book courier is working");
});
app.listen(port, () => {
  console.log(`App is listening from port ${port}`);
});

run();
