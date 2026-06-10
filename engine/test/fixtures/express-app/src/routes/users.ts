import { Router } from "express";

export const usersRouter = Router();

function listUsers(req, res) {
  res.json([]);
}

function getUser(req, res) {
  res.json({ id: req.params.id });
}

usersRouter.get("/", listUsers);
usersRouter.route("/:id").get(getUser);
usersRouter.post("/", (req, res) => res.status(201).json({}));
