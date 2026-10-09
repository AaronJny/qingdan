/** Unsupported HTML stays in the lossless source editor. Conservative
 * detection is deliberate: choosing source editing is safer than conversion. */
export function hasUnsupportedRichFormat(text: string): boolean {
  // GFM tables and image links are supported by the shared schema.
  // Raw HTML can contain attributes or structures Markdown cannot preserve.
  return /<\/?[a-z][\w:-]*(?:\s|\/?>)/i.test(text);
}
