import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getMe(userId: string) {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    await this.repo.update(userId, { fullName: dto.fullName.trim() });
    return this.getMe(userId);
  }

  async deleteMe(userId: string) {
    await this.repo.softDelete(userId);
  }
}
