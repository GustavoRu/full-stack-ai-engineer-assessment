import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersRepository } from './users.repository.js';

export type AuthResult = { accessToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    const normalized = normalizeEmail(email);
    if (await this.usersRepo.findByEmail(normalized)) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.usersRepo.create(normalized, await argon2.hash(password));
    return this.issueToken(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.usersRepo.findByEmail(normalizeEmail(email));
    // Same error for both cases so the response does not reveal which emails exist
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueToken(user.id, user.email);
  }

  private async issueToken(sub: string, email: string): Promise<AuthResult> {
    return { accessToken: await this.jwt.signAsync({ sub, email }) };
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
