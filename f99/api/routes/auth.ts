import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { usersRepo } from "../db/store.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_EXPIRES = "7d";

router.post("/register", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (usersRepo.findByEmail(email)) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const user = {
    id: uuid(),
    email,
    password_hash: hash,
    created_at: new Date().toISOString(),
  };
  usersRepo.insert(user);
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES,
  });
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const user = usersRepo.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRES,
  });
  res.status(200).json({
    token,
    user: { id: user.id, email: user.email },
  });
});

router.post("/logout", async (_req: Request, res: Response) => {
  res.status(200).json({ success: true });
});

export const verifyToken = (token: string): { id: string; email: string } | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string };
  } catch {
    return null;
  }
};

export { JWT_SECRET };
export default router;
