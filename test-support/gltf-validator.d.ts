// Minimal typing for the Khronos reference validator (the package ships no declarations); only the API the tests use.
declare module 'gltf-validator' {
  interface ValidationReport { issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: { code: string; message: string; pointer?: string; severity: number }[] } }
  const validator: { validateBytes(data: Uint8Array, options?: { maxIssues?: number; uri?: string }): Promise<ValidationReport> };
  export default validator;
}
