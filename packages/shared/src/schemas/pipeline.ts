import { z } from 'zod';
import { StageType, valuesOf } from '../enums.js';
import { isoDateTime, uuid } from './common.js';

export const pipelineStageDto = z.object({
  id: uuid,
  pipelineId: uuid,
  name: z.string(),
  sortOrder: z.number().int(),
  probability: z.number().int(),
  type: z.enum(valuesOf(StageType)),
  isActive: z.boolean(),
});
export type PipelineStageDto = z.infer<typeof pipelineStageDto>;

export const pipelineDto = z.object({
  id: uuid,
  name: z.string(),
  isDefault: z.boolean(),
  stages: z.array(pipelineStageDto),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type PipelineDto = z.infer<typeof pipelineDto>;

export const createPipelineBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    isDefault: z.boolean().optional(),
    stages: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          probability: z.number().int().min(0).max(100),
          type: z.enum(valuesOf(StageType)).default('open'),
        }),
      )
      .min(2)
      .max(30)
      .optional(),
  })
  .strict();

export const updatePipelineBody = z
  .object({ name: z.string().trim().min(1).max(80).optional(), isDefault: z.boolean().optional() })
  .strict();

export const createStageBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    probability: z.number().int().min(0).max(100),
    type: z.enum(valuesOf(StageType)).default('open'),
  })
  .strict();

export const updateStageBody = createStageBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict();
