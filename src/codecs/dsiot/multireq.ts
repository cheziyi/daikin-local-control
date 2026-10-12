import { DaikinError } from "../../error.js";

// The DSIOT (BRP084, `type=GPF`) protocol speaks one endpoint, `/dsiot/multireq`,
// carrying operations on property trees. A request addresses a resource (`to`);
// a tree node has pn (name) / pt (type) / pch (children) / pv (value) / md
// (metadata: mi min, mx max, st step).

export const DSIOT_OPERATIONS = {
  get: 2,
  update: 3,
  delete: 4,
} as const;

/** The indoor and the outdoor unit are separate edges on the adapter. */
export const DSIOT_EDGES = {
  indoor: "adr_0100",
  outdoor: "adr_0200",
} as const;

const EDGE_ROOT = "/dsiot/edge";

/** What a read fetches, as the `to` of a request: whole trees, never single
 * leaves. The status trees come with `pt`, which `parseDsiotCapabilities`
 * reads. */
export const DSIOT_TARGETS = {
  adapterInfo: `${EDGE_ROOT}.adp_i?filter=pv`,
  indoorStatus: `${EDGE_ROOT}/${DSIOT_EDGES.indoor}.dgc_status?filter=pv,pt,md`,
  outdoorStatus: `${EDGE_ROOT}/${DSIOT_EDGES.outdoor}.dgc_status?filter=pv,pt,md`,
} as const;

interface PropertyNode {
  pn: string;
  pt?: number;
  pv?: unknown;
  pch?: PropertyNode[];
  md?: { mi?: unknown; mx?: unknown; st?: unknown };
}

interface MultireqResponse {
  rsc?: number | string;
  pc?: PropertyNode;
}

/** One leaf to write: `path` is dotted from its resource, such as
 * `dgc_status.e_1002.e_A002.p_01`, and `value` is the leaf's hex string. */
export interface DsiotUpdate {
  path: string;
  value: string;
}

export function buildDsiotMultireqGet(targets: readonly string[]): object {
  return {
    requests: targets.map((to) => ({ op: DSIOT_OPERATIONS.get, to })),
  };
}

/** Builds the body of a multireq write: one `update` request per resource on
 * `edge`, carrying every leaf in a single tree. A `path` that names a resource
 * alone throws an `Error`. */
export function buildDsiotMultireqUpdate(
  updates: DsiotUpdate[],
  edge: string = DSIOT_EDGES.indoor,
): object {
  const roots: PropertyNode[] = [];
  for (const { path, value } of updates) {
    const [rootName, ...rest] = path.split(".");
    if (rootName === undefined || rest.length === 0) {
      throw new Error(`Cannot write the DSIOT path "${path}"`);
    }
    let node = childNamed(roots, rootName);
    for (const name of rest) {
      node.pch ??= [];
      node = childNamed(node.pch, name);
    }
    node.pv = value;
  }
  return {
    requests: roots.map((pc) => ({
      op: DSIOT_OPERATIONS.update,
      to: `${EDGE_ROOT}/${edge}.${pc.pn}`,
      pc,
    })),
  };
}

function childNamed(siblings: PropertyNode[], name: string): PropertyNode {
  let child = siblings.find((node) => node.pn === name);
  if (child === undefined) {
    child = { pn: name };
    siblings.push(child);
  }
  return child;
}

/** Flattens a `/dsiot/multireq` reply into dotted paths -> `pv`, plus
 * `<path>.pt` where a leaf's type came back and `<path>.md.mi` / `.md.mx` /
 * `.md.st` where metadata did.
 *
 * Each of its `responses` carries its own `rsc`; any not starting with 200 is
 * the adapter refusing, and throws a `DaikinError`: status 401 for `rsc` 401
 * or 4001, 503 for 503, 502 for anything else. A body that is not JSON, or has
 * no `responses` array, throws one with status 502. */
export function parseDsiotMultireqReply(body: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DaikinError("DSIOT reply was not JSON", 502);
  }
  const responses = (parsed as { responses?: MultireqResponse[] } | null)
    ?.responses;
  if (!Array.isArray(responses)) {
    throw new DaikinError("DSIOT reply had no `responses` array", 502);
  }
  const values: Record<string, string> = {};
  for (const response of responses) {
    assertRscOk(response.rsc);
    if (response.pc) {
      flatten(response.pc, undefined, values);
    }
  }
  return values;
}

function assertRscOk(rsc: number | string | undefined): void {
  if (rsc === undefined || String(rsc).startsWith("200")) {
    return;
  }
  const code = String(rsc);
  if (code === "401" || code === "4001") {
    throw new DaikinError(`Daikin rejected the credentials (rsc=${code})`, 401);
  }
  throw new DaikinError(
    `Daikin command failed (rsc=${code})`,
    code === "503" ? 503 : 502,
  );
}

function flatten(
  node: PropertyNode,
  parent: string | undefined,
  values: Record<string, string>,
): void {
  const path = parent === undefined ? node.pn : `${parent}.${node.pn}`;
  if (node.pch) {
    for (const child of node.pch) {
      flatten(child, path, values);
    }
    return;
  }
  if (node.pv !== undefined) {
    values[path] = stringify(node.pv);
  }
  if (node.pt !== undefined) {
    values[`${path}.pt`] = stringify(node.pt);
  }
  for (const key of ["mi", "mx", "st"] as const) {
    const metadata = node.md?.[key];
    if (metadata !== undefined && metadata !== null) {
      values[`${path}.md.${key}`] = stringify(metadata);
    }
  }
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
