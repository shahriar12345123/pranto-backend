import express from "express";
import cors from "cors";
import compression from "compression";
import apiRoutes from "./routes/apiRoutes.js";
import { supabase } from "./config/supabase.js";
import { initStoreSettingsFromDb } from "./config/checkoutConfig.js";

const app = express();

// Initialize dynamic store settings from Supabase
initStoreSettingsFromDb(supabase);

app.use(compression());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl) and all web origins
    callback(null, true);
  },
  credentials: true,
  maxAge: 86400 // Cache CORS preflight response for 24 hours
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
