import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import db from "./src/db.ts";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
    console.warn("WARNING: GEMINI_API_KEY is not set or is using the placeholder value.");
  }

  app.use(express.json());

  // API Routes
  app.get("/api/topics", (req, res) => {
    const topics = db.prepare("SELECT * FROM topics ORDER BY created_at DESC").all();
    res.json(topics);
  });

  app.post("/api/topics", (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const info = db.prepare("INSERT INTO topics (name, status) VALUES (?, ?)").run(name, 'processing');
    const topicId = info.lastInsertRowid;

    res.json({ id: topicId, name, status: 'processing' });
  });

  app.get("/api/topics/:id/graph", (req, res) => {
    const graph = db.prepare("SELECT * FROM graphs WHERE topic_id = ?").get(req.params.id);
    if (!graph) return res.json({ nodes: [], links: [] });
    res.json(JSON.parse(graph.data));
  });

  app.post("/api/topics/:id/graph", (req, res) => {
    const { data } = req.body;
    db.prepare("INSERT INTO graphs (topic_id, data) VALUES (?, ?)").run(req.params.id, JSON.stringify(data));
    db.prepare("UPDATE topics SET status = 'completed' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/topics/:id/error", (req, res) => {
    db.prepare("UPDATE topics SET status = 'error' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
