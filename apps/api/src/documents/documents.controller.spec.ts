import { BadRequestException } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import type { DocumentsService } from './documents.service.js';

describe('DocumentsController.create', () => {
  it('passes an absent body to the service instead of crashing', async () => {
    const create = vi.fn().mockRejectedValue(new BadRequestException('Provide a file or text'));
    const controller = new DocumentsController({ create } as unknown as DocumentsService);

    // A request with no parseable body reaches the handler with an undefined DTO
    await expect(controller.create({ id: 'user-1', email: 'a@b.c' }, undefined, undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(create).toHaveBeenCalledWith('user-1', { file: undefined, text: undefined, title: undefined });
  });
});
