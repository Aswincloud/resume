// HTML files imported into the Worker are bundled as text via the wrangler
// "Text" module rule; declare them so TypeScript treats the import as a string.
declare module "*.html" {
  const content: string;
  export default content;
}
