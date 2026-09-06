import { Router, type Router as ExpressRouter } from "express";
import { bankDirectory } from "../bank-directory.js";

export const bankRouter: ExpressRouter = Router();

bankRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ banks: await bankDirectory().listBanks() });
  } catch (error) {
    next(error);
  }
});
