const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");
const app = express();
const port = 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Note: This application requires Docker Compose to set environment variables
// (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, REDIS_PORT).
// Run with `docker compose up --build -d`, not `npm start` directly.

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Redis connection
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});

// Handle Redis connection errors
redisClient.on("error", (err) => console.error("Redis Client Error", err));

// Connect to Redis
(async () => {
  await redisClient.connect();
})();

// Initialize taskCount in Redis if not set
async function initializeTaskCount() {
  // TODO:
  // 1. Check if "taskCount" exists in Redis
  const cached = await redisClient.get("taskCount");
  if (cached !== null) {
    return; // Already initialized
  }

  // 2. If not, query PostgreSQL to count all tasks
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM tasks;");
  
  // 3. Store the result back into Redis
  await redisClient.set("taskCount", String(rows[0].count)); // defines it if missing
}

// POST /tasks: Create a new task
app.post("/tasks", async (req, res) => {
  // Input format: { title, description, status }
  const { title, description, status } = req.body;
  // TODO:
  // 1. Check that "title" is provided in the request body
  if (!title || typeof title !== "string" || title.trim() === ""){
    // 2. If missing, respond with HTTP 400 and { error: "Title is required" }
    return res.status(400).json({ error: "Title is required" });
}
  
  try {
    // TODO:
    // 1. Insert the task into PostgreSQL ("tasks" table, JSONB column `data`)
    const payload = {
    title,
    description: description ?? null,
    status: status ?? "pending",
  };
    const insert = await pool.query(
    "INSERT INTO tasks (data) VALUES ($datavalues::jsonb) RETURNING id;",
    [JSON.stringify(payload)]
  );
    // 2. Increment "taskCount" in Redis
    await redisClient.incr("taskCount");

    // 3. Respond with HTTP 201 and { id: <new_id> }
    res.status(201).json({ id: insert.rows[0].id });
  } 
  
  catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /tasks: Retrieve all tasks
app.get("/tasks", async (req, res) => {
  try {
    // TODO:
    // 1. Query all tasks from PostgreSQL
    const { rows } = await pool.query("SELECT * FROM tasks;");
    // 2. Respond with an array of tasks:
    //    [{ id: <id>, data: { ... } }, ...]
    res.json(rows.map(row => ({ id: row.id, data: row.data })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /tasks/:id: Retrieve a task by ID
app.get("/tasks/:id", async (req, res) => {
  try {
    // TODO:
    // 1. Query PostgreSQL for the task with the given ID
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1;", [id]);
    if (rows.length > 0) {
      // 2. If found, respond with { id: <id>, data: { ... } }
      return res.status(200), res.json({ id: rows[0].id, data: rows[0].data });
    } else {
      // 3. If not found, respond with 404 and { error: "Task not found" }
      return res.status(404).json({ error: "Task not found" });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /tasks/:id: Update a task by ID (supports partial update)
app.put("/tasks/:id", async (req, res) => {
  try {
    // TODO:
    // 1. Retrieve the existing task from PostgreSQL
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1;", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const existingData = rows[0].data;
    const updatedData = { ...existingData, ...req.body };

    await pool.query(
      "UPDATE tasks SET data = $datavalues::jsonb WHERE id = $1;",
      [JSON.stringify(updatedData), id]
    );
    return res.json({ id: rows[0].id, data: updatedData });

    // 2. Merge request body fields into existing task data
    //    (e.g., only update provided fields like title or status,
    //     keep other fields unchanged)
    // 3. Save the updated record back into PostgreSQL
    // 4. Respond with the updated task:
    //    { id: <id>, data: { ... } }
    // 5. If task not found, respond with 404 and { error: "Task not found" }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /tasks/:id: Delete a task by ID
app.delete("/tasks/:id", async (req, res) => {
  try {
    // TODO:
    // 1. Delete task from PostgreSQL
    const { id } = req.params;
    const result = await pool.query("DELETE FROM tasks WHERE id = $1 RETURNING *;", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    // 2. If deleted, decrement "taskCount" in Redis
    await redisClient.decr("taskCount");
    res.status(204).send();
    // 3. Respond with HTTP status 204 (No Content)
    // 4. If task not found, respond with 404 and { error: "Task not found" }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /stats: Retrieve cached task count
app.get("/stats", async (req, res) => {
  try {
    // TODO:
    // 1. Ensure "taskCount" is initialized in Redis (use initializeTaskCount())
    await initializeTaskCount();
    const taskCount = await redisClient.get("taskCount");
    res.json({ taskCount: parseInt(taskCount, 10) });
    // 2. Retrieve "taskCount" from Redis

    // 3. Respond with { taskCount: <number> }
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});