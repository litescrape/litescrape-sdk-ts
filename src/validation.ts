import { z } from "zod";
import { ValidationError } from "./errors.js";

export const optional = <S extends z.ZodType>(schema: S) => schema.nullish();
export const text = z.union([z.string(), z.number().finite(), z.bigint()]).transform(String);
export const number = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
      .transform(Number),
    z.boolean().transform(Number),
  ])
  .pipe(z.number().finite());
export const integer = number.pipe(z.number().int());
export const boolean = z
  .union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z
      .string()
      .toLowerCase()
      .pipe(z.enum(["0", "1", "true", "false", "yes", "no", "on", "off", "t", "f", "y", "n"])),
  ])
  .transform((value) => [true, 1, "1", "true", "yes", "on", "t", "y"].includes(value));
export const flag = z
  .union([z.enum(["0", "1"]), z.literal(0), z.literal(1), z.boolean()])
  .transform((value) => (value === true || value === 1 || value === "1" ? ("1" as const) : ("0" as const)));
export const strictBoolean = z.union([z.boolean(), z.enum(["true", "false"])]);
export const timeoutSeconds = z.number().finite().gt(0).max(90);
export const device = z.enum(["desktop", "tablet", "mobile"]);

type Params = Record<string, unknown>;
export type Rule = (params: Params, context: z.RefinementCtx) => void;
export const issue = (context: z.RefinementCtx, message: string, path: string[] = []) =>
  context.addIssue({ code: "custom", message, path });
export const has = (params: Params, field: string) => params[field] !== null && params[field] !== undefined;
export const requireAny =
  (...fields: string[]): Rule =>
  (p, c) => {
    if (!fields.some((f) => has(p, f))) issue(c, `one of ${fields.join(", ")} is required`);
  };
export const exactlyOne =
  (...fields: string[]): Rule =>
  (p, c) => {
    if (fields.filter((f) => has(p, f)).length !== 1)
      issue(c, `exactly one of ${fields.join(", ")} is required`);
  };
export const atMostOne =
  (...fields: string[]): Rule =>
  (p, c) => {
    const found = fields.filter((f) => has(p, f));
    if (found.length > 1) issue(c, `${found.join(" and ")} cannot be combined`);
  };
export const paired =
  (a: string, b: string): Rule =>
  (p, c) => {
    if (has(p, a) !== has(p, b)) issue(c, `${a} and ${b} must be given together`);
  };
export const requires =
  (field: string, dependency: string): Rule =>
  (p, c) => {
    if (has(p, field) && !has(p, dependency)) issue(c, `${field} requires ${dependency}`);
  };

/** Validated, immutable request. Construct an endpoint class or pass a plain object to scrape. */
export class ScrapeRequest<E extends string = string> {
  declare readonly endpoint: E;
  declare readonly timeout?: number | null;
  readonly #path: string;

  constructor(path: string, params: object & { endpoint: E }, prototype?: object) {
    this.#path = path;
    Object.assign(this, params);
    if (prototype) Object.setPrototypeOf(this, prototype);
    Object.freeze(this);
  }

  get path(): string {
    return this.#path;
  }

  queryParams(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this)
        .filter(([key, value]) => key !== "endpoint" && value != null)
        .map(([key, value]) => [key, String(value)]),
    );
  }

  query_params(): Record<string, string> {
    return this.queryParams();
  }

  /** Copy a validated request with a default deadline without revalidating its cursor context. */
  withTimeout(timeout: number): this {
    const checked = timeoutSeconds.parse(timeout);
    return new ScrapeRequest(this.path, { ...this, timeout: checked }, Object.getPrototypeOf(this)) as this;
  }
}

export interface RequestClass<E extends string, Input, Output> {
  new (params: Input): ScrapeRequest<E> & Readonly<Output>;
  readonly endpoint: E;
  readonly path: string;
  readonly parameters: readonly string[];
}

export function defineRequest<E extends string, Shape extends z.ZodRawShape>(
  endpoint: E,
  path: string,
  shape: Shape,
  rules: Rule[] = [],
): RequestClass<E, z.input<z.ZodObject<Shape>>, z.output<z.ZodObject<Shape>>> {
  const schema = z.strictObject(shape).superRefine((params, ctx) => {
    for (const rule of rules) rule(params, ctx);
  });
  class Request extends ScrapeRequest<E> {
    static readonly endpoint = endpoint;
    static readonly path = path;
    static readonly parameters = Object.freeze(Object.keys(shape));
    constructor(params: z.input<typeof schema>) {
      const result = schema.safeParse(params);
      if (!result.success)
        throw new ValidationError([
          [
            0,
            result.error.issues
              .map((i) => `${i.path.join(".")}${i.path.length ? ": " : ""}${i.message}`)
              .join("; "),
          ],
        ]);
      super(path, { ...result.data, endpoint });
    }
  }
  return Request as unknown as RequestClass<E, z.input<z.ZodObject<Shape>>, z.output<z.ZodObject<Shape>>>;
}
