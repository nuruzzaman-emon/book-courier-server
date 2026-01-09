require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const admin = require("firebase-admin");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
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
    return res.status(401).send({ message: "Unauthorized Access1" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access2" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized Access3" });
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
    const ordersCollection = db.collection("orders");
    const paymentsCollection = db.collection("payments");
    const mapDataCollection = db.collection("mapData");
    const wishListCollection = db.collection("wishList");

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
      // console.log(user);
      if (!user || user?.role !== "librarian") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    //user related apis
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const query = { role: req.query.role };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

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

    app.patch("/users/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const role = req.body;
      const updateDoc = {
        $set: role,
      };
      console.log(role, updateDoc);
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role || "user" });
    });

    //book related apis
    //book for user
    app.get("/all-books", async (req, res) => {
      const { status, search, limit } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }
      if (search) {
        query.$or = [
          { bookName: { $regex: search, $options: "i" } },
          { authorName: { $regex: search, $options: "i" } },
        ];
      }

      const result = await booksCollection
        .find(query)
        .sort({ price: -1 })
        .limit(Number(limit))
        .toArray();
      res.send(result);
    });

    //book for admin
    app.get(
      "/all-books-admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { search, limit } = req.query;
        const query = {};

        if (search) {
          query.$or = [
            { bookName: { $regex: search, $options: "i" } },
            { authorName: { $regex: search, $options: "i" } },
          ];
        }

        const result = await booksCollection
          .find(query)
          .limit(Number(limit))
          .toArray();
        res.send(result);
      }
    );

    //book for bookOwner
    app.get(
      "/books-library",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
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
      }
    );

    app.post("/books", verifyFBToken, verifyLibrarian, async (req, res) => {
      const book = req.body;
      book.createdAt = new Date();
      if (book.status === "published") {
        book.publishedAt = new Date();
      }
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });
    app.get("/book-details/:id", verifyFBToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });
    app.patch("/books", async (req, res) => {
      const { bookId, newStatus } = req.query;
      const query = { _id: new ObjectId(bookId) };
      const updateDoc = {
        $set: {
          status: newStatus,
        },
      };
      const result = await booksCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    app.delete("/books/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.deleteOne(query);
      res.send(result);
    });

    //orders related apis

    app.get("/my-orders", verifyFBToken, async (req, res) => {
      const query = { customerEmail: req.query.email };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/orders", async (req, res) => {
      const query = { bookAuthorEmail: req.query.email };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });
    app.patch("/orders/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const status = req.body;
      const updateDoc = {
        $set: status,
      };
      const result = await ordersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.post("/book-orders", verifyFBToken, async (req, res) => {
      const orderInfo = req.body;
      orderInfo.orderDate = new Date();
      orderInfo.status = "pending";
      orderInfo.paymentStatus = "unpaid";
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result);
    });

    app.patch("/book-orders/:id", verifyFBToken, async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const updateDoc = {
        $set: req.body,
      };
      const result = await ordersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //payment related APIs

    app.post("/payment-checkout-sessions", verifyFBToken, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.bookName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.customerEmail,
        metadata: {
          name: paymentInfo.bookName,
          orderId: paymentInfo.orderId,
        },
        mode: "payment",
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(process.env.SITE_DOMAIN);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", verifyFBToken, async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);
      const transectionId = session.payment_intent;
      const query = {
        transectionId,
      };
      const alreadyPaid = await paymentsCollection.findOne(query);
      if (alreadyPaid) {
        return res.send({ message: "Already Paid " });
      }

      if (session.payment_status === "paid") {
        const query = { _id: new ObjectId(session.metadata.orderId) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
          },
        };
        const result = await ordersCollection.updateOne(query, updateDoc);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookName: session.metadata.name,
          orderId: session.metadata.orderId,
          transectionId,
          paidAt: new Date(),
        };
        await paymentsCollection.insertOne(payment);
        return res.send(result);
      }
      res.send({ success: "false" });
    });

    app.get("/payments-history", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const query = { customerEmail: email };
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });

    //for map
    app.get("/coverage", async (req, res) => {
      const result = await mapDataCollection.find().toArray();
      res.send(result);
    });

    //for wishlist
    app.post("/user-wishlist", verifyFBToken, async (req, res) => {
      const book = req.body;
      const userEmail = req.decoded_email;
      const wishlistQuery = {
        bookId: book.bookId,
        userEmail,
      };
      const existingWishListItem = await wishListCollection.findOne(
        wishlistQuery
      );
      if (existingWishListItem) {
        return res.send({ message: "Already Added to Wishlist" });
      }
      book.seenAt = new Date();
      const result = await wishListCollection.insertOne(book);
      res.send(result);
    });

    app.get("/user-wishlist", verifyFBToken, async (req, res) => {
      const { email } = req.query;
      const query = { userEmail: email };
      const result = await wishListCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/user-wishlist/:id", async (req, res) => {
      const query = { _id: new ObjectId(req.params.id) };
      const result = await wishListCollection.deleteOne(query);
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
