import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DemoUserSeeder } from './demo-user.seeder.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      // Global so the guard registered in AppModule can verify tokens
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN_SECONDS', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersRepository, DemoUserSeeder],
})
export class AuthModule {}
