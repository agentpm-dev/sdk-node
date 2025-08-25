import type { JsonValue, ToolMeta } from '../index';

// --- Minimal JSON Schema shapes we care about ---
type JsonSchemaProperty = { type?: string; [k: string]: unknown };
type JsonSchemaObject = {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isJsonSchemaObject(x: unknown): x is JsonSchemaObject {
  if (!isPlainObject(x)) return false;
  if (x['type'] !== 'object') return false;

  const props = x['properties'];
  return !(props !== undefined && !isPlainObject(props));
}

// --- Loaded tool shape (generic over input/output) ---
export type Loaded<I extends JsonValue = JsonValue, O extends JsonValue = JsonValue> = {
  func: (input: I) => Promise<O>;
  meta: ToolMeta;
};

// --- A minimal surface for the returned LC tool (works for tests and most usage) ---
type LCTool = { name: string; description: string; func: (input: unknown) => Promise<string> };

// --- Options ---
export type ToLangChainOpts<O extends JsonValue = JsonValue> = {
  /** Override tool name/description if desired */
  name?: string;
  description?: string;
  /**
   * Map the tool result to a string (LangChain tools expect string returns).
   * Default: if outputs has a single string field, return it; else JSON.stringify(result).
   */
  resultToString?: (result: O) => string;
  /** If true, always use DynamicTool (string input) even if inputs look structured */
  forceSimple?: boolean;
};

// --- Helpers ---
function isRecordJson(x: JsonValue): x is Record<string, JsonValue> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function defaultResultToString(result: JsonValue, meta?: ToolMeta): string {
  if (isJsonSchemaObject(meta?.outputs)) {
    const o = meta.outputs; // safe due to guard
    const key = Array.isArray(o.required) ? o.required[0] : undefined;

    if (
      key &&
      o.properties?.[key]?.type === 'string' &&
      isRecordJson(result) &&
      typeof result[key] === 'string'
    ) {
      // with noUncheckedIndexedAccess, result[key] is JsonValue | undefined;
      // typeof === 'string' narrows it; using String(...) keeps TS happy.
      return String(result[key]);
    }
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// --- Main adapter ---
export async function toLangChainTool<
  I extends JsonValue = JsonValue,
  O extends JsonValue = JsonValue,
>(loaded: Loaded<I, O>, opts: ToLangChainOpts<O> = {}): Promise<LCTool> {
  // Type the dynamic import to avoid `any`
  const toolsMod = (await import('@langchain/core/tools')) as {
    DynamicTool: new (args: {
      name: string;
      description: string;
      func: (input: string) => Promise<string>;
    }) => LCTool;
    DynamicStructuredTool: new (args: {
      name: string;
      description: string;
      schema: Record<string, unknown>;
      func: (args: Record<string, JsonValue>) => Promise<string>;
    }) => LCTool;
  };

  const { DynamicStructuredTool, DynamicTool } = toolsMod;
  const meta = loaded.meta ?? ({} as ToolMeta);

  const name = opts.name ?? meta.name ?? 'agentpm_tool';
  const descBase = opts.description ?? meta.description ?? '';
  const richDesc =
    descBase +
    (meta.inputs ? ` Inputs: ${JSON.stringify(meta.inputs)}.` : '') +
    (meta.outputs ? ` Outputs: ${JSON.stringify(meta.outputs)}.` : '');

  const resultToString = opts.resultToString ?? ((r: O) => defaultResultToString(r, meta));

  // Prefer structured tool if meta.inputs looks like a JSON Schema object
  if (!opts.forceSimple && isJsonSchemaObject(meta.inputs)) {
    const schema = meta.inputs as unknown as Record<string, unknown>;

    return new DynamicStructuredTool({
      name,
      description: richDesc,
      schema,
      func: async (args: Record<string, JsonValue>) => {
        const res = await loaded.func(args as unknown as I);
        return resultToString(res);
      },
    });
  }

  // Fallback: single-string input tools (DynamicTool)
  return new DynamicTool({
    name,
    description: richDesc,
    func: async (input: string) => {
      let payload: JsonValue = input;

      if (isJsonSchemaObject(meta.inputs)) {
        const props = Object.keys(meta.inputs.properties ?? {});

        if (props.includes('text')) {
          // cast to index-signature shape to satisfy JsonValue
          payload = { text: input } as Record<string, JsonValue>;
        } else if (props.length === 1) {
          const onlyKey = props[0]; // string | undefined
          if (onlyKey) {
            const obj: Record<string, JsonValue> = {};
            obj[onlyKey] = input; // <- key is guaranteed string here
            payload = obj; // JsonValue includes { [k: string]: JsonValue }
          }
        } else {
          // try structured input via JSON, otherwise wrap
          try {
            payload = JSON.parse(input) as JsonValue;
          } catch {
            payload = { input } as Record<string, JsonValue>;
          }
        }
      }

      const res = await loaded.func(payload as I);
      return resultToString(res);
    },
  });
}

// Usage:
// import { load } from '@agentpm/sdk';
// import { toLangChainTool } from '@agentpm/sdk/adapters/langchain';
//
// const loaded = (await load('@zack/summarize@0.1.0', { withMeta: true })) as {
//   func: (x: any) => Promise<any>; meta: any
// };
//
// const lcTool = await toLangChainTool(loaded);
// // -> pass [lcTool] to LangChain agent
