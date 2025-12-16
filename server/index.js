const express = require("express");
const app = express();
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");
require("dotenv").config();

// Use the port provided by the hosting provider (Render) or 3001 for local dev
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    // Allow connections from anywhere (needed for Vercel deployment)
    origin: "*", 
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8,
});

const userMap = new Map();

function getUsersInRoom(room) {
  const users = [];
  const clients = io.sockets.adapter.rooms.get(room);
  if (clients) {
    for (const clientId of clients) {
      const user = userMap.get(clientId);
      if (user) users.push(user.username);
    }
  }
  return users;
}

app.post("/login", async (req, res) => {
  const { username, password, avatar_seed } = req.body;
  try {
    const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      if (user.password === password) {
        if (avatar_seed) {
           await pool.query("UPDATE users SET avatar_seed = $1 WHERE id = $2", [avatar_seed, user.id]);
           return res.json({ success: true, message: "Login successful", avatar_seed });
        }
        return res.json({ success: true, message: "Login successful", avatar_seed: user.avatar_seed });
      } else {
        return res.json({ success: false, message: "Wrong password" });
      }
    } else {
      const newAvatar = avatar_seed || "avataaars:pixel-art";
      await pool.query("INSERT INTO users (username, password, avatar_seed) VALUES ($1, $2, $3)", [username, password, newAvatar]);
      return res.json({ success: true, message: "Account created & Logged in", avatar_seed: newAvatar });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // Cleanup listeners to prevent memory leaks on reconnect
  socket.removeAllListeners("join_room");
  socket.removeAllListeners("send_message");
  socket.removeAllListeners("callUser");
  socket.removeAllListeners("answerCall");
  socket.removeAllListeners("ice-candidate");
  socket.removeAllListeners("endCall");
  socket.removeAllListeners("drawing");
  socket.removeAllListeners("clear");
  socket.removeAllListeners("disconnect");

  socket.on("join_room", async (data) => {
    socket.join(data.room);
    userMap.set(socket.id, { username: data.username, room: data.room });

    try {
      const history = await pool.query(
        "SELECT * FROM messages WHERE room = $1 ORDER BY created_at ASC LIMIT 50",
        [data.room]
      );
      socket.emit("load_history", history.rows);
    } catch (err) {
      console.error(err);
    }

    const systemMessage = {
      room: data.room,
      author: "SYSTEM",
      message: `${data.username} has joined the chat`,
      type: "text",
      time: new Date().getHours() + ":" + new Date().getMinutes(),
    };
    socket.to(data.room).emit("receive_message", systemMessage);

    const userList = getUsersInRoom(data.room);
    io.to(data.room).emit("room_users", userList);
  });

  socket.on("send_message", async (data) => {
    try {
      await pool.query(
        "INSERT INTO messages (room, author, message, time, type, avatar) VALUES ($1, $2, $3, $4, $5, $6)",
        [data.room, data.author, data.message, data.time, data.type || "text", data.avatar]
      );
    } catch (err) {
      console.error(err);
    }
    socket.to(data.room).emit("receive_message", data);
  });

  socket.on("typing", (data) => {
    socket.to(data.room).emit("display_typing", data.username);
  });

  // --- WEBRTC SIGNALING ---
  socket.on("callUser", (data) => {
    socket.to(data.room).emit("callUser", { 
        signal: data.signalData, 
        from: data.from, 
        name: data.name,
        callType: data.callType
    });
  });

  socket.on("answerCall", (data) => {
    socket.to(data.room).emit("callAccepted", data.signal);
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.room).emit("ice-candidate", data.candidate);
  });

  socket.on("endCall", (data) => {
    socket.to(data.room).emit("callEnded");
  });

  // --- WHITEBOARD SIGNALING ---
  socket.on("drawing", (data) => {
    socket.to(data.room).emit("drawing", data);
  });

  socket.on("clear", (room) => {
    socket.to(room).emit("clear");
  });

  socket.on("disconnect", () => {
    const user = userMap.get(socket.id);
    if (user) {
      const systemMessage = {
        room: user.room,
        author: "SYSTEM",
        message: `${user.username} has left the chat`,
        type: "text",
        time: new Date().getHours() + ":" + new Date().getMinutes(),
      };
      socket.to(user.room).emit("receive_message", systemMessage);

      userMap.delete(socket.id);

      const userList = getUsersInRoom(user.room);
      io.to(user.room).emit("room_users", userList);
    }
    console.log("User Disconnected", socket.id);
  });
});

// Listen on the dynamic PORT (important for Render)
server.listen(PORT, () => {
  console.log(`SERVER RUNNING on port ${PORT}`);
});