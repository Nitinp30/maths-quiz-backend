const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.once("open", () => console.log("Connected to MongoDB"));

// Mongoose model
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  score: { type: Number, default: 0 },
});
const User = mongoose.model("User", UserSchema);

// Middleware to verify JWT
function verifyToken(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).send("Access Denied");

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send("Invalid Token");
    req.user = user;
    next();
  });
}

// Routes
app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).send("User registered successfully");
  } catch (err) {
    res.status(400).send("Error creating user");
  }
});

app.get("/", async (req, res) => {
  try {
    const question = generateQuestion();
    res.json(question);
  } catch (err) {
    res.status(500).send("Error logging in");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).send("User not found");

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).send("Invalid credentials");

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );
    res.json({ token, username });
  } catch (err) {
    res.status(500).send("Error logging in");
  }
});

// Socket.IO Quiz Logic
let currentIndex = 0;
let questions = [];
let isAnswered = false;

// Generate random math questions
function generateQuestion() {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const operator = ["+", "-", "*"][Math.floor(Math.random() * 3)];
  const expression = `${num1} ${operator} ${num2}`;
  const answer = eval(expression);
  return { question: expression, answer };
}

// Generate 10 questions and store them in questions array
for (let i = 0; i < 10; i++) {
  questions.push(generateQuestion());
}

function broadcastQuestion() {
  if (currentIndex < questions.length) {
    io.emit("new-question", {
      question: questions[currentIndex]?.question,
      index: currentIndex + 1,
    });
    isAnswered = false;
  }
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("authenticate", (token) => {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        socket.emit("auth-error", "Invalid token");
        return socket.disconnect();
      }
      socket.user = user;
      console.log(`${user.username} authenticated`);

      socket.emit("new-question", {
        question: questions[currentIndex]?.question,
        index: currentIndex + 1,
      });
    });
  });

  socket.on("submit-answer", async ({ answer, username }) => {
    if (isAnswered) return;

    if (parseFloat(answer) === questions[currentIndex]?.answer) {
      isAnswered = true;

      const user = await User.findOne({ username });
      if (user) {
        user.score += 1;
        await user.save();
      }

      io.emit("winner", {
        username,
        correctAnswer: questions[currentIndex]?.answer,
        scores: await User.find({}, { username: 1, score: 1 }).sort({
          score: -1,
        }),
      });

      setTimeout(() => {
        currentIndex++;
        broadcastQuestion();
      }, 5000);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

broadcastQuestion();

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
