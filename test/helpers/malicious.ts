export const PAYLOAD_SQLI_CLASSIC = "' OR 1=1 --";
export const PAYLOAD_SQLI_UNION = "' UNION SELECT NULL,NULL,NULL--";
export const PAYLOAD_NOSQL_OPERATOR = { $gt: "" };
export const PAYLOAD_XSS_SCRIPT = "<script>alert(1)</script>";
export const PAYLOAD_XSS_IMG = "<img src=x onerror=alert(1)>";
export const PAYLOAD_PATH_TRAVERSAL = "../../../../etc/passwd";
export const PAYLOAD_CRLF_INJECTION = "foo\r\nX-Injected: yes";
export const PAYLOAD_NULL_BYTE = "abc\u0000def";
export const PAYLOAD_UNICODE_HOMO = "а@test.local";
export const PAYLOAD_MALFORMED_JSON = '{"email":';

export const oversizedBody = (mb: number) => ({
  blob: "x".repeat(mb * 1024 * 1024),
});

export const deepNested = (depth: number) => {
  const root: any = {};
  let cursor: any = root;
  for (let i = 0; i < depth; i++) {
    cursor.n = {};
    cursor = cursor.n;
  }
  return root;
};
