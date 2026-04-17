/**
 * JSON Schema compatibility checks for pathways.
 *
 * Pathways chain executable output schemas into subsequent input schemas. This
 * module performs the static compatibility analysis and generates human-readable
 * explanations when two adjacent steps do not line up.
 */
import type { JsonSchema7Type } from "zod-to-json-schema";

/** Primitive JSON Schema types used by the compatibility checker. */
type JsonPrimitiveType = "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";
type JsonLiteral = string | number | boolean | null;

/** Expanded JSON Schema node shape tailored to the features this checker understands. */
type JsonSchemaNode = JsonSchema7Type & {
  $schema?: string;
  $ref?: string;
  definitions?: Record<string, JsonSchemaNode>;
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  type?: JsonPrimitiveType | JsonPrimitiveType[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  propertyNames?: JsonSchemaNode;
  items?: JsonSchemaNode | JsonSchemaNode[];
  additionalItems?: boolean | JsonSchemaNode;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  const?: JsonLiteral;
  enum?: JsonLiteral[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  not?: JsonSchemaNode;
  unevaluatedProperties?: boolean;
  title?: string;
  description?: string;
  markdownDescription?: string;
  default?: unknown;
};

export type CompatibilityIssue = {
  path: string;
  reason: string;
  source: string;
  target: string;
};

type CompatibilityResult = CompatibilityIssue | null;
type Bound = { value: number; exclusive: boolean } | null;

const META_KEYS = new Set([
  "$schema",
  "title",
  "description",
  "markdownDescription",
  "default",
  "definitions"
]);

/** Turn a JSON Schema into a short, reader-friendly description string. */
export function describeSchema(schema: JsonSchema7Type): string {
  const jsonSchema = schema as JsonSchemaNode;
  return describeJsonSchema(jsonSchema, jsonSchema);
}

/** Compare two JSON Schemas and return the first incompatibility, if any. */
export function validateJsonSchemaCompatibility(
  sourceSchema: JsonSchema7Type,
  targetSchema: JsonSchema7Type
): CompatibilityResult {
  const source = sourceSchema as JsonSchemaNode;
  const target = targetSchema as JsonSchemaNode;

  return compareJsonSchemas(source, target, [], source, target);
}

function compareJsonSchemas(
  sourceSchema: JsonSchemaNode,
  targetSchema: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const source = resolveJsonSchema(sourceSchema, sourceRoot);
  const target = resolveJsonSchema(targetSchema, targetRoot);

  // Resolve unions and intersections first so later comparisons can stay simpler.
  if (source.$ref || target.$ref) {
    return issue(
      path,
      "The JSON Schema contains unresolved references, which pathway validation cannot compare safely yet.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (isImpossibleSchema(source)) {
    return null;
  }

  if (isImpossibleSchema(target)) {
    return issue(
      path,
      "The next step input schema does not accept any value.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (isAnySchema(target)) {
    return null;
  }

  if (isAnySchema(source)) {
    return issue(
      path,
      "The previous step produces an unconstrained value, so compatibility cannot be guaranteed.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceBranches = getUnionBranches(source);

  if (sourceBranches) {
    for (const branch of sourceBranches) {
      const branchIssue = compareJsonSchemas(branch, target, path, sourceRoot, targetRoot);

      if (branchIssue) {
        return branchIssue;
      }
    }

    return null;
  }

  const targetBranches = getUnionBranches(target);

  if (targetBranches) {
    for (const branch of targetBranches) {
      if (!compareJsonSchemas(source, branch, path, sourceRoot, targetRoot)) {
        return null;
      }
    }

    return issue(
      path,
      "The previous step output does not match any branch that the next step accepts.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const mergedSource = tryMergeAllOfSchema(source, sourceRoot);

  if (mergedSource) {
    return compareJsonSchemas(mergedSource, target, path, sourceRoot, targetRoot);
  }

  if (source.allOf) {
    return issue(
      path,
      "The previous step uses an intersection JSON Schema that static pathway validation cannot compare safely yet.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const mergedTarget = tryMergeAllOfSchema(target, targetRoot);

  if (mergedTarget) {
    return compareJsonSchemas(source, mergedTarget, path, sourceRoot, targetRoot);
  }

  if (target.allOf) {
    for (const branch of target.allOf) {
      const branchIssue = compareJsonSchemas(source, branch, path, sourceRoot, targetRoot);

      if (branchIssue) {
        return branchIssue;
      }
    }

    return null;
  }

  if (source.const !== undefined) {
    return compareLiteralValue(source.const, target, path, targetRoot);
  }

  if (source.enum && source.enum.length > 0) {
    for (const value of source.enum) {
      const valueIssue = compareLiteralValue(value, target, path, targetRoot);

      if (valueIssue) {
        return valueIssue;
      }
    }

    return null;
  }

  if (target.const !== undefined) {
    return issue(
      path,
      "The next step only accepts a single literal value, but the previous step can produce a broader set.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (target.enum && target.enum.length > 0) {
    return issue(
      path,
      "The next step only accepts specific enum values, but the previous step can produce a broader set.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceKind = getSchemaKind(source);
  const targetKind = getSchemaKind(target);

  if (sourceKind === "object" && targetKind === "object") {
    return compareObjectSchemas(source, target, path, sourceRoot, targetRoot);
  }

  if (sourceKind === "array" && targetKind === "array") {
    return compareArraySchemas(source, target, path, sourceRoot, targetRoot);
  }

  if (sourceKind && targetKind && isPrimitiveKind(sourceKind) && isPrimitiveKind(targetKind)) {
    return comparePrimitiveSchemas(source, target, sourceKind, targetKind, path, sourceRoot, targetRoot);
  }

  return issue(
    path,
    "The previous step output schema is not assignable to the next step input schema.",
    source,
    target,
    sourceRoot,
    targetRoot
  );
}

/** Compare object schemas, including required keys and strict additional-property rules. */
function compareObjectSchemas(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceProperties = source.properties ?? {};
  const targetProperties = target.properties ?? {};
  const sourceRequired = new Set<string>(source.required ?? []);
  const targetRequired = new Set<string>(target.required ?? []);

  for (const key of Object.keys(sourceProperties)) {
    if (target.propertyNames && compareLiteralValue(key, target.propertyNames, path.concat(key), targetRoot)) {
      return issue(
        path.concat(key),
        "The previous step uses a property name that the next step does not accept.",
        JSON.stringify(key),
        target.propertyNames,
        sourceRoot,
        targetRoot
      );
    }
  }

  for (const key of targetRequired) {
    if (!sourceRequired.has(key)) {
      return issue(
        path.concat(key),
        "The previous step may omit this value, but the next step requires it.",
        sourceProperties[key] ?? "missing",
        targetProperties[key] ?? "required value",
        sourceRoot,
        targetRoot
      );
    }
  }

  for (const [key, targetProperty] of Object.entries(targetProperties) as [string, JsonSchemaNode][]) {
    const sourceProperty = sourceProperties[key];

    if (!sourceProperty) {
      continue;
    }

    const propertyIssue = compareJsonSchemas(
      sourceProperty,
      targetProperty,
      path.concat(key),
      sourceRoot,
      targetRoot
    );

    if (propertyIssue) {
      return propertyIssue;
    }
  }

  const targetAdditionalProperties = normalizeAdditionalProperties(target);

  for (const [key, sourceProperty] of Object.entries(sourceProperties) as [string, JsonSchemaNode][]) {
    if (key in targetProperties) {
      continue;
    }

    if (targetAdditionalProperties === false) {
      return issue(
        path.concat(key),
        "The previous step emits this extra field, but the next step is strict and will reject it.",
        sourceProperty,
        target,
        sourceRoot,
        targetRoot
      );
    }

    if (targetAdditionalProperties === true) {
      continue;
    }

    const additionalPropertyIssue = compareJsonSchemas(
      sourceProperty,
      targetAdditionalProperties,
      path.concat(key),
      sourceRoot,
      targetRoot
    );

    if (additionalPropertyIssue) {
      return additionalPropertyIssue;
    }
  }

  const sourceAdditionalProperties = normalizeAdditionalProperties(source);

  if (sourceAdditionalProperties === false) {
    return null;
  }

  if (target.propertyNames) {
    return issue(
      path,
      "The previous step allows arbitrary property names, but the next step restricts which names are valid.",
      source,
      target.propertyNames,
      sourceRoot,
      targetRoot
    );
  }

  if (targetAdditionalProperties === false) {
    return issue(
      path,
      "The previous step may emit extra object keys, but the next step is strict and will reject them.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (sourceAdditionalProperties === true) {
    if (targetAdditionalProperties === true) {
      return null;
    }

    return issue(
      path,
      "The previous step allows arbitrary extra object values, but the next step constrains extra fields.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (targetAdditionalProperties === true) {
    return null;
  }

  return compareJsonSchemas(
    sourceAdditionalProperties,
    targetAdditionalProperties,
    path.concat("[key]"),
    sourceRoot,
    targetRoot
  );
}

function compareArraySchemas(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const boundsIssue = compareArrayBounds(source, target, path, sourceRoot, targetRoot);

  if (boundsIssue) {
    return boundsIssue;
  }

  const sourceTupleItems = getTupleItems(source);
  const targetTupleItems = getTupleItems(target);

  if (sourceTupleItems && targetTupleItems) {
    return compareTupleToTuple(source, target, sourceTupleItems, targetTupleItems, path, sourceRoot, targetRoot);
  }

  if (sourceTupleItems) {
    return compareTupleToArray(source, target, sourceTupleItems, path, sourceRoot, targetRoot);
  }

  if (targetTupleItems) {
    return compareArrayToTuple(source, target, targetTupleItems, path, sourceRoot, targetRoot);
  }

  const sourceItems = getArrayItemSchema(source);
  const targetItems = getArrayItemSchema(target);

  if (!targetItems) {
    return null;
  }

  if (!sourceItems) {
    return issue(
      path.concat("[*]"),
      "The previous step array allows unconstrained items, but the next step expects a specific item shape.",
      source,
      targetItems,
      sourceRoot,
      targetRoot
    );
  }

  return compareJsonSchemas(sourceItems, targetItems, path.concat("[*]"), sourceRoot, targetRoot);
}

function compareTupleToTuple(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  sourceItems: JsonSchemaNode[],
  targetItems: JsonSchemaNode[],
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceRest = getAdditionalItemsSchema(source);
  const targetRest = getAdditionalItemsSchema(target);

  for (let index = 0; index < sourceItems.length; index += 1) {
    const sourceItem = sourceItems[index]!;
    const targetItem = targetItems[index] ?? (targetRest === true ? undefined : targetRest);

    if (!targetItem) {
      return issue(
        path.concat(`[${index}]`),
        "The previous step tuple has an item in a position that the next step tuple does not accept.",
        sourceItem,
        target,
        sourceRoot,
        targetRoot
      );
    }

    const itemIssue = compareJsonSchemas(
      sourceItem,
      targetItem,
      path.concat(`[${index}]`),
      sourceRoot,
      targetRoot
    );

    if (itemIssue) {
      return itemIssue;
    }
  }

  if (sourceRest === false) {
    return null;
  }

  if (targetRest === false) {
    return issue(
      path.concat("[*]"),
      "The previous step tuple allows extra items, but the next step tuple does not.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (sourceRest === true) {
    if (targetRest === true) {
      return null;
    }

    return issue(
      path.concat("[*]"),
      "The previous step tuple allows unconstrained extra items, but the next step constrains them.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (targetRest === true) {
    return null;
  }

  return compareJsonSchemas(sourceRest, targetRest, path.concat("[*]"), sourceRoot, targetRoot);
}

function compareTupleToArray(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  sourceItems: JsonSchemaNode[],
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const targetItems = getArrayItemSchema(target);

  if (!targetItems) {
    return null;
  }

  for (let index = 0; index < sourceItems.length; index += 1) {
    const itemIssue = compareJsonSchemas(
      sourceItems[index]!,
      targetItems,
      path.concat(`[${index}]`),
      sourceRoot,
      targetRoot
    );

    if (itemIssue) {
      return itemIssue;
    }
  }

  const sourceRest = getAdditionalItemsSchema(source);

  if (sourceRest === false || sourceRest === true) {
    return sourceRest === false
      ? null
      : issue(
        path.concat("[*]"),
        "The previous step tuple allows unconstrained extra items, but the next step array constrains item values.",
        source,
        targetItems,
        sourceRoot,
        targetRoot
      );
  }

  return compareJsonSchemas(sourceRest, targetItems, path.concat("[*]"), sourceRoot, targetRoot);
}

function compareArrayToTuple(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  targetItems: JsonSchemaNode[],
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceItems = getArrayItemSchema(source);

  if (!sourceItems) {
    return issue(
      path.concat("[*]"),
      "The previous step array allows unconstrained items, but the next step tuple requires specific positions.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceMaxItems = getMaxItems(source);
  const targetRest = getAdditionalItemsSchema(target);
  const comparisonLimit = Number.isFinite(sourceMaxItems)
    ? sourceMaxItems
    : targetRest === false
      ? targetItems.length
      : targetItems.length + 1;

  if (!Number.isFinite(sourceMaxItems) && targetRest === false) {
    return issue(
      path.concat("[*]"),
      "The previous step array can be longer than the next step tuple allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  for (let index = 0; index < comparisonLimit; index += 1) {
    const targetItem = targetItems[index] ?? (targetRest === true ? undefined : targetRest);

    if (!targetItem) {
      return issue(
        path.concat(`[${index}]`),
        "The previous step array can place an item where the next step tuple does not allow one.",
        sourceItems,
        target,
        sourceRoot,
        targetRoot
      );
    }

    const itemIssue = compareJsonSchemas(
      sourceItems,
      targetItem,
      path.concat(`[${index}]`),
      sourceRoot,
      targetRoot
    );

    if (itemIssue) {
      return itemIssue;
    }
  }

  return null;
}

function compareArrayBounds(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceMinItems = getMinItems(source);
  const targetMinItems = getMinItems(target);

  if (sourceMinItems < targetMinItems) {
    return issue(
      path,
      "The previous step can produce shorter arrays than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceMaxItems = getMaxItems(source);
  const targetMaxItems = getMaxItems(target);

  if (sourceMaxItems > targetMaxItems) {
    return issue(
      path,
      "The previous step can produce longer arrays than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (target.uniqueItems && !source.uniqueItems) {
    return issue(
      path,
      "The next step requires unique array items, but the previous step does not guarantee uniqueness.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  return null;
}

function comparePrimitiveSchemas(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  sourceType: Exclude<JsonPrimitiveType, "object" | "array">,
  targetType: Exclude<JsonPrimitiveType, "object" | "array">,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  if (!primitiveTypeAssignable(sourceType, targetType)) {
    return issue(
      path,
      "The previous step output schema is not assignable to the next step input schema.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (targetType === "string") {
    return compareStringConstraints(source, target, path, sourceRoot, targetRoot);
  }

  if (targetType === "number" || targetType === "integer") {
    return compareNumberConstraints(source, target, path, sourceRoot, targetRoot);
  }

  return null;
}

function compareStringConstraints(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceMinLength = source.minLength ?? 0;
  const targetMinLength = target.minLength ?? 0;

  if (sourceMinLength < targetMinLength) {
    return issue(
      path,
      "The previous step can produce shorter strings than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceMaxLength = source.maxLength ?? Number.POSITIVE_INFINITY;
  const targetMaxLength = target.maxLength ?? Number.POSITIVE_INFINITY;

  if (sourceMaxLength > targetMaxLength) {
    return issue(
      path,
      "The previous step can produce longer strings than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (target.format && source.format !== target.format) {
    return issue(
      path,
      "The next step requires a specific string format that the previous step does not guarantee.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (target.pattern && source.pattern !== target.pattern) {
    return issue(
      path,
      "The next step requires a specific string pattern that the previous step does not guarantee.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  return null;
}

function compareNumberConstraints(
  source: JsonSchemaNode,
  target: JsonSchemaNode,
  path: string[],
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const sourceLowerBound = getLowerBound(source);
  const targetLowerBound = getLowerBound(target);

  if (!isLowerBoundAtLeast(sourceLowerBound, targetLowerBound)) {
    return issue(
      path,
      "The previous step can produce smaller numbers than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  const sourceUpperBound = getUpperBound(source);
  const targetUpperBound = getUpperBound(target);

  if (!isUpperBoundAtMost(sourceUpperBound, targetUpperBound)) {
    return issue(
      path,
      "The previous step can produce larger numbers than the next step allows.",
      source,
      target,
      sourceRoot,
      targetRoot
    );
  }

  if (target.multipleOf !== undefined) {
    if (source.multipleOf === undefined || !isMultipleOfSubset(source.multipleOf, target.multipleOf)) {
      return issue(
        path,
        "The next step requires a numeric multiple that the previous step does not guarantee.",
        source,
        target,
        sourceRoot,
        targetRoot
      );
    }
  }

  return null;
}

function compareLiteralValue(
  value: JsonLiteral,
  target: JsonSchemaNode,
  path: string[],
  targetRoot: JsonSchemaNode
): CompatibilityResult {
  const literalSchema = createLiteralSchema(value);
  const resolvedTarget = resolveJsonSchema(target, targetRoot);

  if (resolvedTarget.$ref) {
    return issue(
      path,
      "The JSON Schema contains unresolved references, which pathway validation cannot compare safely yet.",
      literalSchema,
      resolvedTarget,
      literalSchema,
      targetRoot
    );
  }

  if (isImpossibleSchema(resolvedTarget)) {
    return issue(
      path,
      "The next step input schema does not accept any value.",
      literalSchema,
      resolvedTarget,
      literalSchema,
      targetRoot
    );
  }

  if (isAnySchema(resolvedTarget)) {
    return null;
  }

  const unionBranches = getUnionBranches(resolvedTarget);

  if (unionBranches) {
    for (const branch of unionBranches) {
      if (!compareLiteralValue(value, branch, path, targetRoot)) {
        return null;
      }
    }

    return issue(
      path,
      "The literal value is not accepted by any branch that the next step allows.",
      literalSchema,
      resolvedTarget,
      literalSchema,
      targetRoot
    );
  }

  const mergedTarget = tryMergeAllOfSchema(resolvedTarget, targetRoot);

  if (mergedTarget) {
    return compareLiteralValue(value, mergedTarget, path, targetRoot);
  }

  if (resolvedTarget.allOf) {
    for (const branch of resolvedTarget.allOf) {
      const branchIssue = compareLiteralValue(value, branch, path, targetRoot);

      if (branchIssue) {
        return branchIssue;
      }
    }

    return null;
  }

  if (resolvedTarget.const !== undefined) {
    return Object.is(value, resolvedTarget.const)
      ? null
      : issue(
        path,
        "The literal value is not accepted by the next step.",
        literalSchema,
        resolvedTarget,
        literalSchema,
        targetRoot
      );
  }

  if (resolvedTarget.enum && resolvedTarget.enum.length > 0) {
    return resolvedTarget.enum.some((option: JsonLiteral) => Object.is(option, value))
      ? null
      : issue(
        path,
        "The literal value is not included in the next step enum.",
        literalSchema,
        resolvedTarget,
        literalSchema,
        targetRoot
      );
  }

  const sourceKind = getSchemaKind(literalSchema);
  const targetKind = getSchemaKind(resolvedTarget);

  if (sourceKind && targetKind && isPrimitiveKind(sourceKind) && isPrimitiveKind(targetKind)) {
    return comparePrimitiveSchemas(
      literalSchema,
      resolvedTarget,
      sourceKind,
      targetKind,
      path,
      literalSchema,
      targetRoot
    );
  }

  return issue(
    path,
    "The literal value is not accepted by the next step.",
    literalSchema,
    resolvedTarget,
    literalSchema,
    targetRoot
  );
}

/** Describe a JSON Schema using a compact natural-language summary. */
function describeJsonSchema(
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
  seenRefs: Set<string> = new Set()
): string {
  const resolved = resolveJsonSchema(schema, root, seenRefs);

  if (resolved.$ref) {
    return resolved.$ref;
  }

  const merged = tryMergeAllOfSchema(resolved, root);

  if (merged) {
    return describeJsonSchema(merged, root, seenRefs);
  }

  if (resolved.const !== undefined) {
    return JSON.stringify(resolved.const);
  }

  if (resolved.enum && resolved.enum.length > 0) {
    return resolved.enum.map((value: JsonLiteral) => JSON.stringify(value)).join(" | ");
  }

  const unionBranches = getUnionBranches(resolved);

  if (unionBranches) {
    return unionBranches
      .map((branch) => describeJsonSchema(branch, root, seenRefs))
      .join(" | ");
  }

  if (resolved.allOf) {
    return resolved.allOf
      .map((branch: JsonSchemaNode) => describeJsonSchema(branch, root, seenRefs))
      .join(" & ");
  }

  if (isImpossibleSchema(resolved)) {
    return "never";
  }

  if (isAnySchema(resolved)) {
    return "unknown";
  }

  const kind = getSchemaKind(resolved);

  if (kind === "object") {
    return describeObjectSchema(resolved, root, seenRefs);
  }

  if (kind === "array") {
    return describeArraySchema(resolved, root, seenRefs);
  }

  if (kind) {
    return describePrimitiveSchema(resolved, kind);
  }

  return "unknown";
}

function describeObjectSchema(
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
  seenRefs: Set<string>
): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(properties).map(([key, value]: [string, JsonSchemaNode]) => {
    const label = required.has(key) ? key : `${key}?`;
    return `${label}: ${describeJsonSchema(value, root, seenRefs)}`;
  });

  const additionalProperties = normalizeAdditionalProperties(schema);

  if (additionalProperties === true && fields.length === 0) {
    return "Record<string, unknown>";
  }

  if (additionalProperties !== false && additionalProperties !== true) {
    fields.push(`[key: string]: ${describeJsonSchema(additionalProperties, root, seenRefs)}`);
  }

  return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
}

function describeArraySchema(
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
  seenRefs: Set<string>
): string {
  const tupleItems = getTupleItems(schema);

  if (tupleItems) {
    const items = tupleItems.map((item) => describeJsonSchema(item, root, seenRefs));
    const additionalItems = getAdditionalItemsSchema(schema);

    if (additionalItems && additionalItems !== true) {
      items.push(`...${describeJsonSchema(additionalItems, root, seenRefs)}[]`);
    }

    return `[${items.join(", ")}]`;
  }

  const itemSchema = getArrayItemSchema(schema);
  const itemDescription = itemSchema ? describeJsonSchema(itemSchema, root, seenRefs) : "unknown";

  return `Array<${itemDescription}>`;
}

function describePrimitiveSchema(
  schema: JsonSchemaNode,
  kind: Exclude<JsonPrimitiveType, "object" | "array">
): string {
  const constraints: string[] = [];

  if (kind === "string") {
    if (schema.format) {
      constraints.push(`format=${schema.format}`);
    }

    if (schema.minLength !== undefined) {
      constraints.push(`minLength=${schema.minLength}`);
    }

    if (schema.maxLength !== undefined) {
      constraints.push(`maxLength=${schema.maxLength}`);
    }

    if (schema.pattern) {
      constraints.push(`pattern=${JSON.stringify(schema.pattern)}`);
    }
  }

  if (kind === "number" || kind === "integer") {
    if (schema.minimum !== undefined) {
      constraints.push(`minimum=${schema.minimum}`);
    }

    if (schema.exclusiveMinimum !== undefined) {
      constraints.push(`exclusiveMinimum=${schema.exclusiveMinimum}`);
    }

    if (schema.maximum !== undefined) {
      constraints.push(`maximum=${schema.maximum}`);
    }

    if (schema.exclusiveMaximum !== undefined) {
      constraints.push(`exclusiveMaximum=${schema.exclusiveMaximum}`);
    }

    if (schema.multipleOf !== undefined) {
      constraints.push(`multipleOf=${schema.multipleOf}`);
    }
  }

  if (constraints.length === 0) {
    return kind;
  }

  return `${kind} { ${constraints.join(", ")} }`;
}

function resolveJsonSchema(
  schema: JsonSchemaNode,
  root: JsonSchemaNode,
  seenRefs: Set<string> = new Set()
): JsonSchemaNode {
  if (!schema.$ref) {
    return schema;
  }

  if (seenRefs.has(schema.$ref)) {
    return schema;
  }

  const resolved = resolveJsonPointer(root, schema.$ref);

  if (!resolved) {
    return schema;
  }

  const nextSeenRefs = new Set(seenRefs);
  nextSeenRefs.add(schema.$ref);

  return resolveJsonSchema(resolved, root, nextSeenRefs);
}

function resolveJsonPointer(root: JsonSchemaNode, ref: string): JsonSchemaNode | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current && typeof current === "object" ? (current as JsonSchemaNode) : undefined;
}

function tryMergeAllOfSchema(schema: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode | null {
  if (!schema.allOf || hasNonMetaSiblingKeys(schema, "allOf")) {
    return null;
  }

  const branches = schema.allOf.map((branch: JsonSchemaNode) => resolveJsonSchema(branch, root));

  if (!branches.every(canMergeObjectBranch)) {
    return null;
  }

  const properties: Record<string, JsonSchemaNode> = {};
  const required = new Set<string>();
  let additionalProperties: boolean | JsonSchemaNode = true;

  for (const branch of branches) {
    for (const [key, value] of Object.entries(branch.properties ?? {}) as [string, JsonSchemaNode][]) {
      const existing = properties[key];
      properties[key] = existing
        ? ({
          allOf: [existing, value]
        } as JsonSchemaNode)
        : value;
    }

    for (const key of branch.required ?? []) {
      required.add(key);
    }

    additionalProperties = intersectAdditionalProperties(additionalProperties, branch.additionalProperties);
  }

  const mergedSchema: JsonSchemaNode = {
    type: "object",
    properties
  };

  if (required.size > 0) {
    mergedSchema.required = Array.from(required);
  }

  if (additionalProperties !== true) {
    mergedSchema.additionalProperties = additionalProperties;
  }

  return mergedSchema;
}

function canMergeObjectBranch(schema: JsonSchemaNode): boolean {
  if (schema.$ref || schema.anyOf || schema.allOf) {
    return false;
  }

  return getSchemaKind(schema) === "object";
}

function intersectAdditionalProperties(
  left: boolean | JsonSchemaNode,
  right: boolean | JsonSchemaNode | undefined
): boolean | JsonSchemaNode {
  const normalizedRight = right ?? true;

  if (left === false || normalizedRight === false) {
    return false;
  }

  if (left === true) {
    return normalizedRight;
  }

  if (normalizedRight === true) {
    return left;
  }

  return {
    allOf: [left, normalizedRight]
  } as JsonSchemaNode;
}

function hasNonMetaSiblingKeys(schema: JsonSchemaNode, allowedKey: string): boolean {
  return Object.keys(schema).some((key) => !META_KEYS.has(key) && key !== allowedKey);
}

function getUnionBranches(schema: JsonSchemaNode): JsonSchemaNode[] | null {
  if (schema.anyOf && schema.anyOf.length > 0) {
    return schema.anyOf as JsonSchemaNode[];
  }

  if (Array.isArray(schema.type) && schema.type.length > 1) {
    const types = schema.type as JsonPrimitiveType[];

    return types.map((type: JsonPrimitiveType) => ({
      ...schema,
      type
    })) as JsonSchemaNode[];
  }

  return null;
}

function getSchemaKind(schema: JsonSchemaNode): JsonPrimitiveType | null {
  const explicitType = getSingleType(schema);

  if (explicitType) {
    return explicitType;
  }

  if (schema.properties || schema.additionalProperties !== undefined || schema.propertyNames) {
    return "object";
  }

  if (schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined) {
    return "array";
  }

  if (schema.const !== undefined) {
    return literalType(schema.const);
  }

  if (schema.enum && schema.enum.length > 0) {
    const literalTypes = Array.from(
      new Set<Exclude<JsonPrimitiveType, "object" | "array">>(
        schema.enum.map((value: JsonLiteral) => literalType(value))
      )
    );
    return literalTypes.length === 1 ? literalTypes[0]! : null;
  }

  if (schema.format || schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern) {
    return "string";
  }

  if (
    schema.minimum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMaximum !== undefined ||
    schema.multipleOf !== undefined
  ) {
    return "number";
  }

  return null;
}

function getSingleType(schema: JsonSchemaNode): JsonPrimitiveType | null {
  if (!schema.type) {
    return null;
  }

  return Array.isArray(schema.type) ? (schema.type.length === 1 ? schema.type[0]! : null) : schema.type;
}

function isPrimitiveKind(kind: JsonPrimitiveType): kind is Exclude<JsonPrimitiveType, "object" | "array"> {
  return kind !== "object" && kind !== "array";
}

function primitiveTypeAssignable(
  sourceType: Exclude<JsonPrimitiveType, "object" | "array">,
  targetType: Exclude<JsonPrimitiveType, "object" | "array">
): boolean {
  if (sourceType === targetType) {
    return true;
  }

  return sourceType === "integer" && targetType === "number";
}

function getTupleItems(schema: JsonSchemaNode): JsonSchemaNode[] | null {
  return Array.isArray(schema.items) ? (schema.items as JsonSchemaNode[]) : null;
}

function getArrayItemSchema(schema: JsonSchemaNode): JsonSchemaNode | undefined {
  return schema.items && !Array.isArray(schema.items) ? (schema.items as JsonSchemaNode) : undefined;
}

function getAdditionalItemsSchema(schema: JsonSchemaNode): boolean | JsonSchemaNode {
  if (schema.maxItems !== undefined) {
    return false;
  }

  return schema.additionalItems ?? true;
}

function getMinItems(schema: JsonSchemaNode): number {
  return schema.minItems ?? (getTupleItems(schema)?.length ?? 0);
}

function getMaxItems(schema: JsonSchemaNode): number {
  if (schema.maxItems !== undefined) {
    return schema.maxItems;
  }

  return Number.POSITIVE_INFINITY;
}

function normalizeAdditionalProperties(schema: JsonSchemaNode): boolean | JsonSchemaNode {
  return schema.additionalProperties ?? true;
}

function getLowerBound(schema: JsonSchemaNode): Bound {
  if (schema.exclusiveMinimum !== undefined) {
    return {
      value: schema.exclusiveMinimum,
      exclusive: true
    };
  }

  if (schema.minimum !== undefined) {
    return {
      value: schema.minimum,
      exclusive: false
    };
  }

  return null;
}

function getUpperBound(schema: JsonSchemaNode): Bound {
  if (schema.exclusiveMaximum !== undefined) {
    return {
      value: schema.exclusiveMaximum,
      exclusive: true
    };
  }

  if (schema.maximum !== undefined) {
    return {
      value: schema.maximum,
      exclusive: false
    };
  }

  return null;
}

function isLowerBoundAtLeast(source: Bound, target: Bound): boolean {
  if (!target) {
    return true;
  }

  if (!source) {
    return false;
  }

  if (source.value > target.value) {
    return true;
  }

  if (source.value < target.value) {
    return false;
  }

  return !target.exclusive || source.exclusive;
}

function isUpperBoundAtMost(source: Bound, target: Bound): boolean {
  if (!target) {
    return true;
  }

  if (!source) {
    return false;
  }

  if (source.value < target.value) {
    return true;
  }

  if (source.value > target.value) {
    return false;
  }

  return !target.exclusive || source.exclusive;
}

function isMultipleOfSubset(source: number, target: number): boolean {
  const ratio = source / target;
  const roundedRatio = Math.round(ratio);
  return Math.abs(ratio - roundedRatio) < 1e-9;
}

function isAnySchema(schema: JsonSchemaNode): boolean {
  return Object.keys(schema).every((key) => META_KEYS.has(key));
}

function isImpossibleSchema(schema: JsonSchemaNode): boolean {
  return Boolean(schema.not && isAnySchema(schema.not));
}

function literalType(value: JsonLiteral): Exclude<JsonPrimitiveType, "object" | "array"> {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return Number.isInteger(value) ? "integer" : "number";
}

function createLiteralSchema(value: JsonLiteral): JsonSchemaNode {
  return {
    type: literalType(value),
    const: value
  };
}

/** Create a normalized compatibility issue with source and target descriptions. */
function issue(
  path: string[],
  reason: string,
  source: JsonSchemaNode | string,
  target: JsonSchemaNode | string,
  sourceRoot: JsonSchemaNode,
  targetRoot: JsonSchemaNode
): CompatibilityIssue {
  return {
    path: formatPath(path),
    reason,
    source: typeof source === "string" ? source : describeJsonSchema(source, sourceRoot),
    target: typeof target === "string" ? target : describeJsonSchema(target, targetRoot)
  };
}

function formatPath(path: string[]): string {
  if (path.length === 0) {
    return "$";
  }

  return path.reduce((result, segment) => {
    if (segment.startsWith("[")) {
      return `${result}${segment}`;
    }

    return `${result}.${segment}`;
  }, "$");
}
