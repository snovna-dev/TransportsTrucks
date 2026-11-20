const dateFormatter = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});
const moneyFormatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });

type DecimalLike = { toString(): string } | number | null | undefined;

export function formatDate(value: Date | null | undefined) {
  return value ? dateFormatter.format(value) : "—";
}

export function formatDateTime(value: Date | null | undefined) {
  return value ? dateTimeFormatter.format(value) : "—";
}

export function formatMoney(value: DecimalLike) {
  return value === null || value === undefined ? "—" : moneyFormatter.format(Number(value.toString()));
}

export function formatNumber(value: DecimalLike) {
  return value === null || value === undefined ? "—" : numberFormatter.format(Number(value.toString()));
}

export function formatPercent(value: DecimalLike) {
  return value === null || value === undefined ? "—" : `${Math.round(Number(value.toString()) * 100)} %`;
}

export function formatJson(value: unknown) {
  if (value === null || value === undefined || value === "") return "(vacío)";
  return typeof value === "string" ? value : JSON.stringify(value);
}
