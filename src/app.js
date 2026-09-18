import express from "express";
import cors from "cors";
import apiRoutes from "./routes/apiRoutes.js";

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to Pranto Backend API", status: "online" });
});

app.use("/api", apiRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
});

export default app;
