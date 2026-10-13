import { describe, expect, it } from "vitest";
import { DaikinError } from "../../../error.js";
import {
  buildDsiotMultireqGet,
  buildDsiotMultireqUpdate,
  parseDsiotMultireqReply,
} from "../multireq.js";
import { DSIOT_EDGES, DSIOT_TARGETS } from "../tables.js";

describe("DSIOT_TARGETS", () => {
  it("addresses whole trees: values for adp_i and adp_d, and values, types and metadata for each dgc_status", () => {
    expect(DSIOT_TARGETS).toEqual({
      adapterInfo: "/dsiot/edge.adp_i?filter=pv",
      adapterSettings: "/dsiot/edge.adp_d?filter=pv",
      indoorStatus: "/dsiot/edge/adr_0100.dgc_status?filter=pv,pt,md",
      outdoorStatus: "/dsiot/edge/adr_0200.dgc_status?filter=pv,pt,md",
    });
  });
});

describe("buildDsiotMultireqGet", () => {
  it("builds one get request per target, in order", () => {
    expect(
      buildDsiotMultireqGet([
        DSIOT_TARGETS.indoorStatus,
        DSIOT_TARGETS.outdoorStatus,
      ]),
    ).toEqual({
      requests: [
        { op: 2, to: "/dsiot/edge/adr_0100.dgc_status?filter=pv,pt,md" },
        { op: 2, to: "/dsiot/edge/adr_0200.dgc_status?filter=pv,pt,md" },
      ],
    });
  });
});

describe("buildDsiotMultireqUpdate", () => {
  it("merges every leaf of a resource into one tree on the indoor edge", () => {
    expect(
      buildDsiotMultireqUpdate([
        { path: "dgc_status.e_1002.e_A002.p_01", value: "01" },
        { path: "dgc_status.e_1002.e_3001.p_01", value: "0200" },
        { path: "dgc_status.e_1002.e_3001.p_02", value: "30" },
      ]),
    ).toEqual({
      requests: [
        {
          op: 3,
          to: "/dsiot/edge/adr_0100.dgc_status",
          pc: {
            pn: "dgc_status",
            pch: [
              {
                pn: "e_1002",
                pch: [
                  { pn: "e_A002", pch: [{ pn: "p_01", pv: "01" }] },
                  {
                    pn: "e_3001",
                    pch: [
                      { pn: "p_01", pv: "0200" },
                      { pn: "p_02", pv: "30" },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
  });

  it("builds one update request per resource", () => {
    expect(
      buildDsiotMultireqUpdate([
        { path: "dgc_status.e_1002.e_A002.p_01", value: "01" },
        { path: "other_resource.p_01", value: "02" },
      ]),
    ).toMatchObject({
      requests: [
        { op: 3, to: "/dsiot/edge/adr_0100.dgc_status" },
        {
          op: 3,
          to: "/dsiot/edge/adr_0100.other_resource",
          pc: { pn: "other_resource", pch: [{ pn: "p_01", pv: "02" }] },
        },
      ],
    });
  });

  it("writes a leaf given twice once, with its last value", () => {
    expect(
      buildDsiotMultireqUpdate([
        { path: "dgc_status.p_01", value: "00" },
        { path: "dgc_status.p_01", value: "01" },
      ]),
    ).toMatchObject({
      requests: [{ pc: { pn: "dgc_status", pch: [{ pn: "p_01", pv: "01" }] } }],
    });
  });

  it("addresses the edge it is given", () => {
    expect(
      buildDsiotMultireqUpdate(
        [{ path: "dgc_status.e_1003.p_01", value: "01" }],
        DSIOT_EDGES.outdoor,
      ),
    ).toMatchObject({
      requests: [{ to: "/dsiot/edge/adr_0200.dgc_status" }],
    });
  });

  it("throws an Error for a path that names a resource alone", () => {
    expect(() =>
      buildDsiotMultireqUpdate([{ path: "dgc_status", value: "01" }]),
    ).toThrow('Cannot write the DSIOT path "dgc_status"');
  });

  it("builds no request from no updates", () => {
    expect(buildDsiotMultireqUpdate([])).toEqual({ requests: [] });
  });
});

describe("parseDsiotMultireqReply", () => {
  function body(...responses: object[]): string {
    return JSON.stringify({ responses });
  }

  const power = {
    pn: "dgc_status",
    pch: [
      {
        pn: "e_1002",
        pch: [{ pn: "e_A002", pch: [{ pn: "p_01", pv: "01" }] }],
      },
    ],
  };

  it("flattens a tree into dotted paths, with the metadata that came back", () => {
    expect(
      parseDsiotMultireqReply(
        body({
          rsc: 2000,
          pc: {
            pn: "dgc_status",
            pch: [
              {
                pn: "e_1002",
                pch: [
                  { pn: "e_A002", pch: [{ pn: "p_01", pv: "01" }] },
                  {
                    pn: "e_3001",
                    pch: [
                      {
                        pn: "p_02",
                        pv: "3000",
                        md: { mi: "2400", mx: "4000", st: "01" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
    ).toEqual({
      "dgc_status.e_1002.e_A002.p_01": "01",
      "dgc_status.e_1002.e_3001.p_02": "3000",
      "dgc_status.e_1002.e_3001.p_02.md.mi": "2400",
      "dgc_status.e_1002.e_3001.p_02.md.mx": "4000",
      "dgc_status.e_1002.e_3001.p_02.md.st": "01",
    });
  });

  it("flattens the type of a leaf, and of no node with children", () => {
    expect(
      parseDsiotMultireqReply(
        body({
          rsc: 2000,
          pc: {
            pn: "dgc_status",
            pt: 1,
            pch: [{ pn: "p_24", pt: 2, pv: "00" }],
          },
        }),
      ),
    ).toEqual({ "dgc_status.p_24": "00", "dgc_status.p_24.pt": "2" });
  });

  it("merges the trees of every response", () => {
    expect(
      parseDsiotMultireqReply(
        body(
          { rsc: 2000, pc: { pn: "adp_i", pch: [{ pn: "reg", pv: "sg" }] } },
          { rsc: 2000, pc: power },
        ),
      ),
    ).toEqual({
      "adp_i.reg": "sg",
      "dgc_status.e_1002.e_A002.p_01": "01",
    });
  });

  it("writes a value that is not a string as JSON", () => {
    expect(
      parseDsiotMultireqReply(
        body({
          rsc: 2000,
          pc: {
            pn: "dgc_status",
            pch: [
              { pn: "p_01", pv: 4 },
              { pn: "p_02", pv: "0A", md: { st: 5 } },
            ],
          },
        }),
      ),
    ).toEqual({
      "dgc_status.p_01": "4",
      "dgc_status.p_02": "0A",
      "dgc_status.p_02.md.st": "5",
    });
  });

  it("leaves out a leaf without a value, and metadata that is null", () => {
    expect(
      parseDsiotMultireqReply(
        body({
          rsc: 2000,
          pc: {
            pn: "adp_i",
            pch: [{ pn: "empty" }, { pn: "reg", pv: "sg", md: { mi: null } }],
          },
        }),
      ),
    ).toEqual({ "adp_i.reg": "sg" });
  });

  it("reads a reply without trees, as a write gets, as no values", () => {
    expect(parseDsiotMultireqReply(body({ rsc: 2004 }))).toEqual({});
    expect(parseDsiotMultireqReply(body())).toEqual({});
  });

  it.each([2000, 2004, "2000"])("accepts rsc %j", (rsc) => {
    expect(parseDsiotMultireqReply(body({ rsc, pc: power }))).toEqual({
      "dgc_status.e_1002.e_A002.p_01": "01",
    });
  });

  it("accepts a response without an rsc", () => {
    expect(parseDsiotMultireqReply(body({ pc: power }))).toEqual({
      "dgc_status.e_1002.e_A002.p_01": "01",
    });
  });

  it.each([
    [4001, 401],
    [401, 401],
    ["4001", 401],
    [503, 503],
    [4000, 502],
    [500, 502],
  ])(
    "throws a DaikinError for rsc %j, with status %i",
    (rsc, httpStatusCode) => {
      const parse = () => parseDsiotMultireqReply(body({ rsc }));

      expect(parse).toThrow(DaikinError);
      expect(parse).toThrow(`rsc=${rsc}`);
      expect(parse).toThrow(expect.objectContaining({ httpStatusCode }));
    },
  );

  it("throws when any one response failed", () => {
    expect(() =>
      parseDsiotMultireqReply(body({ rsc: 2000, pc: power }, { rsc: 4000 })),
    ).toThrow("rsc=4000");
  });

  it("throws a DaikinError with status 502 for a body that is not JSON", () => {
    const parse = () => parseDsiotMultireqReply("ret=OK");

    expect(parse).toThrow(DaikinError);
    expect(parse).toThrow(expect.objectContaining({ httpStatusCode: 502 }));
  });

  it("throws a DaikinError with status 502 for a body without a responses array", () => {
    for (const body of ['{"responses":{}}', "{}", "null"]) {
      const parse = () => parseDsiotMultireqReply(body);

      expect(parse).toThrow(DaikinError);
      expect(parse).toThrow(expect.objectContaining({ httpStatusCode: 502 }));
    }
  });
});
