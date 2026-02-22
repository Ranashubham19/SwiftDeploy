type UnitMeta = {
  kind: "length" | "mass" | "time" | "volume";
  toBase: number;
};

const linearUnits: Record<string, UnitMeta> = {
  m: { kind: "length", toBase: 1 },
  meter: { kind: "length", toBase: 1 },
  meters: { kind: "length", toBase: 1 },
  km: { kind: "length", toBase: 1000 },
  kilometer: { kind: "length", toBase: 1000 },
  kilometers: { kind: "length", toBase: 1000 },
  cm: { kind: "length", toBase: 0.01 },
  mm: { kind: "length", toBase: 0.001 },
  mi: { kind: "length", toBase: 1609.344 },
  mile: { kind: "length", toBase: 1609.344 },
  miles: { kind: "length", toBase: 1609.344 },
  ft: { kind: "length", toBase: 0.3048 },
  foot: { kind: "length", toBase: 0.3048 },
  feet: { kind: "length", toBase: 0.3048 },
  in: { kind: "length", toBase: 0.0254 },
  inch: { kind: "length", toBase: 0.0254 },
  inches: { kind: "length", toBase: 0.0254 },
  kg: { kind: "mass", toBase: 1 },
  g: { kind: "mass", toBase: 0.001 },
  gram: { kind: "mass", toBase: 0.001 },
  grams: { kind: "mass", toBase: 0.001 },
  lb: { kind: "mass", toBase: 0.45359237 },
  lbs: { kind: "mass", toBase: 0.45359237 },
  pound: { kind: "mass", toBase: 0.45359237 },
  pounds: { kind: "mass", toBase: 0.45359237 },
  oz: { kind: "mass", toBase: 0.028349523125 },
  s: { kind: "time", toBase: 1 },
  sec: { kind: "time", toBase: 1 },
  second: { kind: "time", toBase: 1 },
  seconds: { kind: "time", toBase: 1 },
  min: { kind: "time", toBase: 60 },
  minute: { kind: "time", toBase: 60 },
  minutes: { kind: "time", toBase: 60 },
  h: { kind: "time", toBase: 3600 },
  hr: { kind: "time", toBase: 3600 },
  hour: { kind: "time", toBase: 3600 },
  hours: { kind: "time", toBase: 3600 },
  day: { kind: "time", toBase: 86400 },
  days: { kind: "time", toBase: 86400 },
  l: { kind: "volume", toBase: 1 },
  liter: { kind: "volume", toBase: 1 },
  liters: { kind: "volume", toBase: 1 },
  ml: { kind: "volume", toBase: 0.001 },
  gal: { kind: "volume", toBase: 3.785411784 },
};

const normalizeUnit = (unit: string): string =>
  unit.trim().toLowerCase().replace(/\s+/g, "");

const isTemp = (unit: string): boolean =>
  ["c", "celsius", "f", "fahrenheit", "k", "kelvin"].includes(unit);

const toCelsius = (value: number, unit: string): number => {
  if (unit === "c" || unit === "celsius") return value;
  if (unit === "f" || unit === "fahrenheit") return ((value - 32) * 5) / 9;
  if (unit === "k" || unit === "kelvin") return value - 273.15;
  throw new Error(`Unsupported temperature unit: ${unit}`);
};

const fromCelsius = (value: number, unit: string): number => {
  if (unit === "c" || unit === "celsius") return value;
  if (unit === "f" || unit === "fahrenheit") return (value * 9) / 5 + 32;
  if (unit === "k" || unit === "kelvin") return value + 273.15;
  throw new Error(`Unsupported temperature unit: ${unit}`);
};

export const convertUnit = (value: number, from: string, to: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error("Value must be a finite number.");
  }

  const fromKey = normalizeUnit(from);
  const toKey = normalizeUnit(to);

  if (isTemp(fromKey) || isTemp(toKey)) {
    if (!(isTemp(fromKey) && isTemp(toKey))) {
      throw new Error("Temperature units can only be converted to temperature units.");
    }
    const celsius = toCelsius(value, fromKey);
    return fromCelsius(celsius, toKey);
  }

  const fromMeta = linearUnits[fromKey];
  const toMeta = linearUnits[toKey];

  if (!fromMeta || !toMeta) {
    throw new Error("Unsupported unit. Use common units like m, km, ft, kg, lb, l, ml, min.");
  }
  if (fromMeta.kind !== toMeta.kind) {
    throw new Error(`Cannot convert ${fromMeta.kind} to ${toMeta.kind}.`);
  }

  const baseValue = value * fromMeta.toBase;
  return baseValue / toMeta.toBase;
};
