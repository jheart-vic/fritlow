import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

// Runs a zod schema against the request body BEFORE the controller executes,
// and replaces req.body with the parsed (typed, trimmed, defaulted) result.
// Controllers can therefore trust their input completely.
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    // A request with no body at all leaves req.body undefined — treat that
    // as {} so schemas with only-optional fields (e.g. refresh) can pass.
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    req.body = result.data;
    next();
  };
}
