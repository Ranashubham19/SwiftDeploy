import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

type AsyncTask<T> = () => Promise<T>;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export class DbLockManager {
  private readonly ttlMs: number;
  private readonly retryDelayMs: number;
  private readonly maxWaitMs: number;

  public constructor(
    private readonly prisma: PrismaClient,
    options?: {
      ttlMs?: number;
      retryDelayMs?: number;
      maxWaitMs?: number;
    },
  ) {
    this.ttlMs = options?.ttlMs ?? 30_000;
    this.retryDelayMs = options?.retryDelayMs ?? 180;
    this.maxWaitMs = options?.maxWaitMs ?? 20_000;
  }

  public async withChatLock<T>(chatId: number, task: AsyncTask<T>): Promise<T> {
    const owner = randomUUID();
    await this.acquire(chatId, owner);

    try {
      return await task();
    } finally {
      await this.release(chatId, owner);
    }
  }

  private async acquire(chatId: number, owner: string): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < this.maxWaitMs) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.ttlMs);

      try {
        await this.prisma.chatLock.create({
          data: {
            chatId,
            owner,
            expiresAt,
          },
        });
        return;
      } catch {
        const updated = await this.prisma.chatLock.updateMany({
          where: {
            chatId,
            expiresAt: {
              lte: now,
            },
          },
          data: {
            owner,
            expiresAt,
          },
        });

        if (updated.count > 0) {
          return;
        }
      }

      await sleep(this.retryDelayMs);
    }

    throw new Error(
      `Could not acquire chat lock for chat=${chatId} within ${this.maxWaitMs}ms`,
    );
  }

  private async release(chatId: number, owner: string): Promise<void> {
    await this.prisma.chatLock.deleteMany({
      where: {
        chatId,
        owner,
      },
    });
  }
}
