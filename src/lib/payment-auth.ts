/** RFC-style Payment auth parameters shared by the server and agent buyer. */
export function parsePaymentAuthorization(
  header: string,
): Record<string, string> {
  if (header.length > 2048)
    throw new Error("Payment header exceeds the allowed length.");
  const scheme = /^Payment[\t ]+/iu.exec(header);
  if (!scheme) throw new Error("Expected Payment credentials.");
  const fields = Object.create(null) as Record<string, string>;
  let rest = header.slice(scheme[0].length);
  // Parameter names are case-insensitive. Quoted-pair and token values follow
  // HTTP auth-param syntax; reject duplicate keys, trailing junk and commas.
  const parameter =
    /^[\t ]*([!#$%&'*+.^_`|~\w-]+)[\t ]*=[\t ]*(?:"((?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*)"|([!#$%&'*+.^_`|~\w-]+))[\t ]*/u;
  while (rest) {
    const match = parameter.exec(rest);
    if (!match) throw new Error("Malformed Payment parameter.");
    const key = match[1].toLowerCase();
    if (Object.hasOwn(fields, key))
      throw new Error("Duplicate Payment parameter.");
    fields[key] =
      match[2] === undefined
        ? match[3]
        : match[2].replace(/\\([\x20-\x7e])/gu, "$1");
    rest = rest.slice(match[0].length);
    if (!rest) break;
    if (!rest.startsWith(",") || !rest.slice(1).trim())
      throw new Error("Malformed Payment parameter separator.");
    rest = rest.slice(1);
  }
  if (!Object.keys(fields).length)
    throw new Error("Payment credentials are empty.");
  return fields;
}

export function paymentAuthorization(fields: Record<string, string>): string {
  return `Payment ${Object.entries(fields)
    .map(([key, value]) => {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key) || /[^\x20-\x7e]/u.test(value))
        throw new Error("Invalid Payment header value.");
      return `${key}="${value.replace(/["\\]/gu, "\\$&")}"`;
    })
    .join(", ")}`;
}
