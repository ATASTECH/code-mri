import express from "express";
import { usersRouter } from "./routes/users";

export const app = express();

function requestLogger(req, res, next) {
  next();
}

app.use(requestLogger);
app.use("/users", usersRouter);

app.get("/health", (req, res) => res.json({ ok: true }));
