import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../database/database.module.js';
import { users, type UserRow } from '../database/schema.js';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async create(email: string, passwordHash: string): Promise<UserRow> {
    const [user] = await this.db.insert(users).values({ email, passwordHash }).returning();
    return user;
  }
}
