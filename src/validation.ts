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
/** Accepts the same spellings as strictBoolean, normalized to a JSON boolean for POST bodies. */
export const jsonBoolean = strictBoolean.transform((value) => value === true || value === "true");
export const timeoutSeconds = z.number().finite().gt(0).max(90);
export const device = z.enum(["desktop", "tablet", "mobile"]);

type Bounds = { min?: number; max?: number };
const bounded = <S extends z.ZodNumber | z.ZodString>(schema: S, { min, max }: Bounds): S => {
  let result = schema;
  if (min !== undefined) result = result.min(min) as S;
  if (max !== undefined) result = result.max(max) as S;
  return result;
};
/** Text with optional character bounds and a full-match pattern. Numbers and bigints are stringified. */
export const string = (min?: number, max?: number, pattern?: RegExp) => {
  const checked = bounded(z.string(), { min, max });
  return text.pipe(pattern ? checked.regex(pattern) : checked);
};
export const int = (min?: number, max?: number) => integer.pipe(bounded(z.number(), { min, max }));
export const decimal = (min?: number, max?: number) => number.pipe(bounded(z.number(), { min, max }));
/** A whole number restricted to the listed values. */
export const choice = <const T extends readonly [number, ...number[]]>(...values: T) =>
  integer.pipe(z.literal(values));
export const isoDate = string(10, 10, /^\d{4}-\d{2}-\d{2}$/);
/** Arrays are sent natively in JSON bodies and as JSON text in query strings. */
export const list = <S extends z.ZodType>(item: S, min = 1, max = 100) => z.array(item).min(min).max(max);

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
export const ordered =
  (low: string, high: string, strict = false): Rule =>
  (p, c) => {
    const [a, b] = [p[low], p[high]];
    if (typeof a === "number" && typeof b === "number" && (strict ? a >= b : a > b))
      issue(c, `${high} must be ${strict ? "greater than" : "at least"} ${low}`);
  };
/** A continuation token that already carries the original parameters and must be sent alone. */
export const alone =
  (field: string): Rule =>
  (p, c) => {
    if (!has(p, field)) return;
    const extra = Object.keys(p).filter((f) => f !== field && f !== "timeout" && has(p, f));
    if (extra.length) issue(c, `send ${field} alone, without ${extra.join(", ")}`);
  };
export const unless =
  (field: string, rules: Rule[]): Rule =>
  (p, c) => {
    if (!has(p, field)) for (const rule of rules) rule(p, c);
  };

export type Method = "GET" | "POST";
const compact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item != null)
        .map(([key, item]) => [key, compact(item)]),
    );
  return value;
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

/** Validated, immutable request. Construct an endpoint class or pass a plain object to scrape. */
export class ScrapeRequest<E extends string = string> {
  declare readonly endpoint: E;
  declare readonly timeout?: number | null;
  readonly #path: string;
  readonly #method: Method;

  constructor(path: string, params: object & { endpoint: E }, prototype?: object, method: Method = "GET") {
    this.#path = path;
    this.#method = method;
    Object.assign(this, params);
    if (prototype) Object.setPrototypeOf(this, prototype);
    freeze(this);
  }

  get path(): string {
    return this.#path;
  }

  /** GET sends queryParams(); POST sends body() as JSON. Batch submissions always use JSON. */
  get method(): Method {
    return this.#method;
  }

  /** Normalized parameters as strings; arrays and objects are JSON-encoded. */
  queryParams(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.body()).map(([key, value]) => [
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      ]),
    );
  }

  /** Normalized parameters with native JSON values, omitting nulls at every level. */
  body(): Record<string, unknown> {
    const { endpoint: _, ...params } = this as Record<string, unknown>;
    void _;
    return compact(params) as Record<string, unknown>;
  }

  query_params(): Record<string, string> {
    return this.queryParams();
  }

  /** Copy a validated request with a default deadline without revalidating its cursor context. */
  withTimeout(timeout: number): this {
    const checked = timeoutSeconds.parse(timeout);
    return new ScrapeRequest(
      this.path,
      { ...this, timeout: checked },
      Object.getPrototypeOf(this),
      this.method,
    ) as this;
  }
}

export interface RequestClass<E extends string, Input, Output> {
  new (params: Input): ScrapeRequest<E> & Readonly<Output>;
  readonly endpoint: E;
  readonly path: string;
  readonly method: Method;
  readonly parameters: readonly string[];
}

export function defineRequest<E extends string, Shape extends z.ZodRawShape>(
  endpoint: E,
  path: string,
  shape: Shape,
  rules: Rule[] = [],
  method: Method = "GET",
): RequestClass<E, z.input<z.ZodObject<Shape>>, z.output<z.ZodObject<Shape>>> {
  const schema = z.strictObject(shape).superRefine((params, ctx) => {
    for (const rule of rules) rule(params, ctx);
  });
  class Request extends ScrapeRequest<E> {
    static readonly endpoint = endpoint;
    static readonly path = path;
    static readonly method = method;
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
      super(path, { ...result.data, endpoint }, undefined, method);
    }
  }
  return Request as unknown as RequestClass<E, z.input<z.ZodObject<Shape>>, z.output<z.ZodObject<Shape>>>;
}
