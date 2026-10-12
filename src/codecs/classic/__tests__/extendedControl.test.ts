import { describe, expect, it } from "vitest";
import {
  applyClassicOutOfHomeAccess,
  encodeClassicDemandControl,
  encodeClassicEnergyPrice,
  encodeClassicEnergyTarget,
  encodeClassicGroup,
  encodeClassicHolidayMode,
  encodeClassicIcon,
  encodeClassicLed,
  encodeClassicName,
  encodeClassicSpecialMode,
  encodeClassicTerminalKey,
  encodeClassicTerminalScope,
  parseClassicEnergyPrice,
  parseClassicEnergyTarget,
  parseClassicHolidayMode,
  parseClassicLed,
  parseClassicMetadata,
  parseClassicOutOfHomeAccess,
} from "../extendedControl.js";

describe("encodeClassicLed", () => {
  it("writes led as 1 or 0", () => {
    expect(encodeClassicLed(true)).toEqual({ led: "1" });
    expect(encodeClassicLed(false)).toEqual({ led: "0" });
  });
});

describe("encodeClassicHolidayMode", () => {
  it("writes en_hol as 1 or 0", () => {
    expect(encodeClassicHolidayMode(true)).toEqual({ en_hol: "1" });
    expect(encodeClassicHolidayMode(false)).toEqual({ en_hol: "0" });
  });
});

describe("encodeClassicDemandControl", () => {
  it("writes the manual mode as mode=0", () => {
    expect(
      encodeClassicDemandControl({
        enabled: true,
        maxPowerInPercent: 70,
        mode: "manual",
      }),
    ).toEqual({ demand_type: "1", en_demand: "1", mode: "0", max_pow: "70" });
  });

  it("writes the auto mode as mode=2", () => {
    expect(
      encodeClassicDemandControl({
        enabled: true,
        maxPowerInPercent: 85,
        mode: "auto",
      }),
    ).toEqual({ demand_type: "1", en_demand: "1", mode: "2", max_pow: "85" });
  });

  it("writes en_demand=0 when disabled", () => {
    expect(
      encodeClassicDemandControl({
        enabled: false,
        maxPowerInPercent: 40,
        mode: "manual",
      }),
    ).toEqual({ demand_type: "1", en_demand: "0", mode: "0", max_pow: "40" });
  });
});

describe("encodeClassicSpecialMode", () => {
  it("writes powerful as spmode_kind=1", () => {
    expect(encodeClassicSpecialMode("powerful", true)).toEqual({
      set_spmode: "1",
      spmode_kind: "1",
    });
  });

  it("writes econo as spmode_kind=2", () => {
    expect(encodeClassicSpecialMode("econo", false)).toEqual({
      set_spmode: "0",
      spmode_kind: "2",
    });
  });

  it("writes streamer as en_streamer alone", () => {
    expect(encodeClassicSpecialMode("streamer", true)).toEqual({
      en_streamer: "1",
    });
    expect(encodeClassicSpecialMode("streamer", false)).toEqual({
      en_streamer: "0",
    });
  });
});

describe("applyClassicOutOfHomeAccess", () => {
  const current = {
    ret: "OK",
    method: "polling",
    notice_ip_int: "3600",
    notice_sync_int: "60",
  };

  it("writes the method as `polling` when enabled and `home only` when not", () => {
    expect(applyClassicOutOfHomeAccess({}, true).method).toBe("polling");
    expect(applyClassicOutOfHomeAccess({}, false).method).toBe("home only");
  });

  it("copies the intervals, and nothing else, from the get_remote_method reply", () => {
    expect(applyClassicOutOfHomeAccess(current, false)).toEqual({
      method: "home only",
      notice_ip_int: "3600",
      notice_sync_int: "60",
    });
  });

  it("leaves out an interval the reply lacks", () => {
    expect(
      applyClassicOutOfHomeAccess({ ret: "OK", notice_ip_int: "3600" }, true),
    ).toEqual({ method: "polling", notice_ip_int: "3600" });
  });
});

describe("encodeClassicEnergyPrice", () => {
  it("splits the price into whole units and hundredths", () => {
    expect(encodeClassicEnergyPrice(1.15)).toEqual({
      price_int: "1",
      price_dec: "15",
    });
    expect(encodeClassicEnergyPrice(0.3)).toEqual({
      price_int: "0",
      price_dec: "30",
    });
  });

  it("writes the hundredths as a number, without a leading zero", () => {
    expect(encodeClassicEnergyPrice(1.05)).toEqual({
      price_int: "1",
      price_dec: "5",
    });
    expect(encodeClassicEnergyPrice(4)).toEqual({
      price_int: "4",
      price_dec: "0",
    });
  });

  it("rounds the price to two decimal places", () => {
    expect(encodeClassicEnergyPrice(0.126)).toEqual({
      price_int: "0",
      price_dec: "13",
    });
    expect(encodeClassicEnergyPrice(1.999)).toEqual({
      price_int: "2",
      price_dec: "0",
    });
  });
});

describe("encodeClassicEnergyTarget", () => {
  it("writes the target", () => {
    expect(encodeClassicEnergyTarget(120)).toEqual({ target: "120" });
  });
});

describe("encodeClassicName", () => {
  it("writes the name unencoded", () => {
    expect(encodeClassicName("Living Room")).toEqual({ name: "Living Room" });
  });
});

describe("encodeClassicIcon", () => {
  it("writes the icon code", () => {
    expect(encodeClassicIcon("5")).toEqual({ icon: "5" });
  });
});

describe("encodeClassicGroup", () => {
  it("writes the group's name and whether the unit is in it", () => {
    expect(encodeClassicGroup({ name: "Upstairs", enabled: true })).toEqual({
      grp_name: "Upstairs",
      en_grp: "1",
    });
    expect(encodeClassicGroup({ name: "Upstairs", enabled: false })).toEqual({
      grp_name: "Upstairs",
      en_grp: "0",
    });
  });
});

describe("encodeClassicTerminalKey", () => {
  it("writes the key", () => {
    expect(encodeClassicTerminalKey("0123456789abcdef")).toEqual({
      key: "0123456789abcdef",
    });
  });
});

describe("encodeClassicTerminalScope", () => {
  it.each([
    ["self", "0"],
    ["others", "1"],
    ["all", "2"],
  ] as const)("writes %s as type=%s", (scope, type) => {
    expect(encodeClassicTerminalScope(scope)).toEqual({ type });
  });
});

describe("parseClassicLed", () => {
  it("reads led as on or off, and a reply without it as null", () => {
    expect(parseClassicLed({ led: "1" })).toBe(true);
    expect(parseClassicLed({ led: "0" })).toBe(false);
    expect(parseClassicLed({})).toBeNull();
  });
});

describe("parseClassicHolidayMode", () => {
  it("reads en_hol as on or off, and a reply without it as null", () => {
    expect(parseClassicHolidayMode({ en_hol: "1" })).toBe(true);
    expect(parseClassicHolidayMode({ en_hol: "0" })).toBe(false);
    expect(parseClassicHolidayMode({})).toBeNull();
  });
});

describe("parseClassicOutOfHomeAccess", () => {
  it("reads the polling method as on, any other as off, and a reply without one as null", () => {
    expect(parseClassicOutOfHomeAccess({ method: "polling" })).toBe(true);
    expect(parseClassicOutOfHomeAccess({ method: "home only" })).toBe(false);
    expect(parseClassicOutOfHomeAccess({})).toBeNull();
  });
});

describe("parseClassicEnergyPrice", () => {
  it("adds price_dec to price_int as hundredths", () => {
    expect(parseClassicEnergyPrice({ price_int: "27", price_dec: "5" })).toBe(
      27.05,
    );
    expect(parseClassicEnergyPrice({ price_int: "0", price_dec: "30" })).toBe(
      0.3,
    );
  });

  it("reads a reply missing either field as null", () => {
    expect(parseClassicEnergyPrice({ price_int: "27" })).toBeNull();
    expect(parseClassicEnergyPrice({ price_dec: "5" })).toBeNull();
  });
});

describe("parseClassicEnergyTarget", () => {
  it("reads target as a number, and a reply without it as null", () => {
    expect(parseClassicEnergyTarget({ target: "120" })).toBe(120);
    expect(parseClassicEnergyTarget({})).toBeNull();
  });
});

describe("parseClassicMetadata", () => {
  it("reads the name, icon and group, decoding the two names", () => {
    expect(
      parseClassicMetadata({
        name: "Living%20Room",
        icon: "5",
        grp_name: "Up+stairs",
        en_grp: "0",
      }),
    ).toEqual({
      name: "Living Room",
      icon: "5",
      group: { name: "Up stairs", enabled: false },
    });
  });

  it("leaves out each field the reply does not carry", () => {
    expect(parseClassicMetadata({})).toEqual({});
  });

  it("reads a group without a name as an empty name", () => {
    expect(parseClassicMetadata({ en_grp: "0" }).group).toEqual({
      name: "",
      enabled: false,
    });
  });
});
