import { type Route } from 'next';

import { type z } from 'zod';

import { convertObjectToURLSearchParams } from './convert-object-to-url-search-params';
import type { ExcludeAny } from './types';

type PathBlueprint = `/${string}`;

type Suffix = `?${string}`;

/**
 * When `experimental.typeRoutes` is disabled,
 * `Route` is `string & {}`, therefore `string extends Route` is a truthy condition.
 * If this is the case, we simply use the `Path` value to infer the literal string.
 *
 * If `experimental.typeRoutes` is enabled,
 * `Route` will be a union of string literals, therefore `string extends Route` is a falsy condition.
 * If this is the case, we use `Route<Path>` so that we have auto-complete on the available routes
 * generated by NextJS and validation check against dynamic routes (that are checked by passing the string generic).
 */
type SafePath<Path extends string> = string extends Route ? Path : Route<Path>;

type ExtractPathParams<T extends string> =
  T extends `${infer Rest}[[...${infer Param}]]` ?
    Param | ExtractPathParams<Rest>
  : T extends `${infer Rest}[...${infer Param}]` ?
    Param | ExtractPathParams<Rest>
  : T extends `${string}[${infer Param}]${infer Rest}` ?
    Param | ExtractPathParams<Rest>
  : never;

export type RouteBuilder<
  Path extends string,
  Params extends z.ZodSchema,
  Search extends z.ZodSchema,
> =
  [Params, Search] extends [never, never] ?
    { (): Path; getSchemas: () => { params: never; search: never } }
  : [Params, Search] extends [z.ZodSchema, never] ?
    {
      (options: z.input<Params>): Path;
      getSchemas: () => { params: Params; search: never };
    }
  : [Params, Search] extends [never, z.ZodSchema] ?
    undefined extends z.input<Search> ?
      {
        (options?: { search?: z.input<Search> }): Path | `${Path}${Suffix}`;
        getSchemas: () => { params: never; search: Search };
      }
    : {
        (options: { search: z.input<Search> }): `${Path}${Suffix}`;
        getSchemas: () => { params: never; search: Search };
      }
  : [Params, Search] extends [z.ZodSchema, z.ZodSchema] ?
    undefined extends z.input<Search> ?
      {
        (
          options: z.input<Params> & { search?: z.input<Search> },
        ): Path | `${Path}${Suffix}`;
        getSchemas: () => { params: Params; search: Search };
      }
    : {
        (
          options: z.input<Params> & { search: z.input<Search> },
        ): `${Path}${Suffix}`;
        getSchemas: () => { params: Params; search: Search };
      }
  : never;

type EnsurePathWithNoParams<Path extends string> =
  ExtractPathParams<Path> extends never ? SafePath<Path>
  : `[ERROR]: Missing validation for path params`;

/**
 * Ensures no extra values are passed to params validation
 */
type StrictParams<Schema extends z.ZodSchema, Keys extends string> =
  Schema extends z.ZodObject<infer Params> ?
    [keyof Params] extends [Keys] ?
      Schema
    : z.ZodObject<{
        [Key in keyof Params]: Key extends Keys ? Params[Key] : never;
      }>
  : never;

type RouteBuilderResult<
  Path extends string,
  PathParams extends string,
  Params extends z.ZodObject<any>,
  Search extends z.ZodSchema,
> =
  [PathParams, Search] extends [string, never] ?
    RouteBuilder<Path, Params, never>
  : [PathParams, Search] extends [never, z.ZodSchema] ?
    RouteBuilder<Path, never, Search>
  : [PathParams, Search] extends [string, z.ZodSchema] ?
    RouteBuilder<Path, Params, Search>
  : never;

const PATH_PARAM_REGEX = /\[{1,2}([^[\]]+)]{1,2}/g;

/**
 * Remove param notation from string to only get the param name when it is a catch-all segment
 *
 * @example
 * ```ts
 * '/shop/[[...slug]]'.replace(PATH_PARAM_REGEX, (match, param) => {
 *   //                                                    ^? '[[...slug]]'
 *   const [sanitizedParam] = REMOVE_PARAM_NOTATION_REGEX.exec(param)
 *   //          ^? 'slug'
 * })
 * ```
 */
const REMOVE_PARAM_NOTATION_REGEX = /[^[.].+[^\]]/;

// @ts-expect-error overload signature does match the implementation,
// the compiler complains about EnsurePathWithNoParams, but it is fine
export function makeRouteBuilder<Path extends PathBlueprint>(
  path: EnsurePathWithNoParams<Path>,
): RouteBuilder<Path, never, never>;

export function makeRouteBuilder<
  Path extends PathBlueprint,
  Params extends z.ZodObject<{
    [K in ExtractPathParams<Path>]: z.ZodSchema;
  }>,
  Search extends z.ZodSchema = never,
>(
  path: SafePath<Path>,
  schemas: ExtractPathParams<Path> extends never ?
    { search: Search | z.ZodOptional<z.ZodSchema> }
  : {
      params: StrictParams<Params, ExtractPathParams<Path>>;
      search?: Search | z.ZodOptional<z.ZodSchema>;
    },
): RouteBuilderResult<
  Path,
  ExtractPathParams<Path>,
  ExcludeAny<Params>,
  ExcludeAny<Search>
>;

export function makeRouteBuilder(
  path: PathBlueprint,
  schemas?: { params?: z.ZodSchema; search?: z.ZodSchema },
): any {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  const hasParamsInPath = PATH_PARAM_REGEX.test(path);
  const isMissingParamsValidation = hasParamsInPath && !schemas?.params;

  if (isMissingParamsValidation) {
    throw new Error(`Validation missing for path params: "${path}"`);
  }

  const routeBuilder: RouteBuilder<string, any, any> = (options) => {
    const { search = {}, ...params } = options ?? {};

    const basePath = path.replace(PATH_PARAM_REGEX, (match, param: string) => {
      const sanitizedParam = REMOVE_PARAM_NOTATION_REGEX.exec(param)?.[0];

      const value = params[sanitizedParam ?? param];

      if (Array.isArray(value)) {
        return value.join('/');
      }

      return value ?? match;
    });

    const urlSearchParams = convertObjectToURLSearchParams(search);

    if (!urlSearchParams.entries().next().done) {
      return [basePath, urlSearchParams.toString()].join('?');
    }

    return basePath;
  };

  routeBuilder.getSchemas = () => ({
    params: schemas?.params,
    search: schemas?.search,
  });

  return routeBuilder;
}

export type makeRouteBuilder = typeof makeRouteBuilder;
