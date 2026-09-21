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

const allowedOrigins = [
  "https://pranto-admin.vercel.app",
  "https://pranto-frontend.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174"
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(null, true);
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
