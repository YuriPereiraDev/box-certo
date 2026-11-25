import { Injectable, OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class SenhaService implements OnModuleInit {
  /** Hash usado quando a conta não existe, para o tempo de resposta não revelar isso. */
  private hashFalso = '';

  async onModuleInit(): Promise<void> {
    this.hashFalso = await this.gerarHash('senha-que-nao-existe-box-certo');
  }

  gerarHash(senha: string): Promise<string> {
    return argon2.hash(senha, { type: argon2.argon2id });
  }

  async verificar(hash: string | null | undefined, senha: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? this.hashFalso, senha);
    } catch {
      return false;
    }
  }
}
