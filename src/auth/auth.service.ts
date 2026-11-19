import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt.strategy';

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const isPasswordValid = user && (await bcrypt.compare(password, user.passwordHash));

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      buildingId: user.buildingId,
      programId: user.programId,
      mustChangePassword: user.mustChangePassword,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: this.toPublicUser(user),
      mustChangePassword: user.mustChangePassword,
    };
  }

  async changePassword(userId: string, { currentPassword, newPassword }: ChangePasswordPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect.');
    }

    if (newPassword.length < 8) {
      throw new UnauthorizedException('Le nouveau mot de passe doit contenir au moins 8 caractères.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        mustChangePassword: false,
      },
    });

    return {
      success: true,
      user: this.toPublicUser(updatedUser),
    };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toPublicUser(user);
  }

  private toPublicUser({ passwordHash: _, ...user }: User): PublicUser {
    return user;
  }
}
