import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const makeController = async (readyState: number) => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: { readyState } },
      ],
    }).compile();
    return module.get<HealthController>(HealthController);
  };

  it('returns ok when mongo readyState is 1', async () => {
    const controller = await makeController(1);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.mongo).toBe('up');
    expect(typeof result.uptime).toBe('number');
  });

  it('throws 503 when mongo readyState is not 1', async () => {
    const controller = await makeController(0);
    await expect(controller.check()).rejects.toMatchObject({
      status: 503,
    });
  });
});
